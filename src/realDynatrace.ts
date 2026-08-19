import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint, TimeRange } from '@/types';
export interface ManagementZoneOption { name:string; }
interface QueryResult { records?:Array<Record<string,unknown>|null>; }
interface HostEntityRecord { id?:unknown; 'entity.name'?:unknown; hostGroupName?:unknown; managementZones?:unknown; }
const RANGE_SPEC:Record<TimeRange,{from:string;interval:string;throughputInterval:string}>={'1h':{from:'1h',interval:'1m',throughputInterval:'1m'},'6h':{from:'6h',interval:'5m',throughputInterval:'1m'},'24h':{from:'24h',interval:'15m',throughputInterval:'5m'},'7d':{from:'7d',interval:'6h',throughputInterval:'15m'},'30d':{from:'30d',interval:'1d',throughputInterval:'1h'}};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function executeDql<T>(query:string):Promise<T[]>{
  try {
    const response=await queryExecutionClient.queryExecute({body:{query,requestTimeoutMilliseconds:30000,maxResultRecords:5000}});
    console.debug('[DYNATRACE][queryExecute]',{query,state:response.state,requestToken:response.requestToken,hasResult:Boolean(response.result),response});
    let result=response.result as QueryResult|undefined;
    const token=response.requestToken;
    let state=response.state;
    for(let attempt=0;!result&&token&&attempt<30;attempt++){
      try {
        const polled=await queryExecutionClient.queryPoll({requestToken:token,requestTimeoutMilliseconds:30000});
        console.debug('[DYNATRACE][queryPoll]',{attempt,requestToken:token,state:polled.state,hasResult:Boolean(polled.result),response:polled});
        state=polled.state;
        result=polled.result as QueryResult|undefined;
        if(!result&&state==='RUNNING') await sleep(300);
      } catch(pollError) {
        console.error('[DYNATRACE][queryPoll ERROR]',{attempt,requestToken:token,query,error:pollError});
        throw pollError;
      }
    }
    if(!result) throw new Error(`Dynatrace DQL query did not return a result (state: ${state}). Query: ${query}`);
    return(result.records??[]).filter(Boolean) as T[];
  } catch(error) {
    console.error('[DYNATRACE][DQL ERROR]',{query,error});
    throw error;
  }
}
const hostId=(v:unknown):string=>Array.isArray(v)?hostId(v[0]):v&&typeof v==='object'?hostId((v as Record<string,unknown>).value??(v as Record<string,unknown>).values??(v as Record<string,unknown>).data??(v as Record<string,unknown>).id):String(v??'').trim();
const numeric=(v:unknown):number|undefined=>{if(typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v)){for(let i=v.length-1;i>=0;i--){const n=numeric(v[i]);if(n!==undefined)return n;}return undefined;}if(typeof v==='string'&&v.trim()){const n=Number(v);return Number.isFinite(n)?n:undefined;}if(v&&typeof v==='object'){const o=v as Record<string,unknown>;for(const k of ['value','double','number']){const n=numeric(o[k]);if(n!==undefined)return n;}}return undefined;};
const series=(v:unknown):Array<number|null>=>Array.isArray(v)?v.map(x=>numeric(x)??null):v&&typeof v==='object'?series((v as Record<string,unknown>).values??(v as Record<string,unknown>).data):(numeric(v)===undefined?[]:[numeric(v)!]);
const last=(v:unknown)=>{const a=series(v);for(let i=a.length-1;i>=0;i--)if(a[i]!==null)return a[i] as number;return undefined;};
const intervalMs=(v:unknown)=>{const s=String(v??'3600000000000');if(/^\d+$/.test(s))return Number(s)/1e6;const m=s.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);return m?Number(m[1])*({s:1000,m:60000,h:3600000,d:86400000}[m[2].toLowerCase()]??3600000):3600000;};
const startMs=(v:unknown)=>{if(v&&typeof v==='object'&&'start'in v){const d=new Date(String((v as{start?:unknown}).start));if(!Number.isNaN(d.getTime()))return d.getTime();}return Date.now()-86400000;};
const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
const hostFilter=(ids:string[])=>ids.length?`filter in(dt.entity.host, ${ids.map(id=>`"${esc(id)}"`).join(', ')})`:'1==0';
async function getEntities(zone?:string):Promise<HostEntityRecord[]>{const selected=zone&&zone!=='All Management Zones';const q=selected?`fetch dt.entity.host | expand managementZones | filter managementZones == "${esc(zone as string)}" | fields id, entity.name, hostGroupName, managementZones | dedup id`:`fetch dt.entity.host | fields id, entity.name, hostGroupName, managementZones | dedup id`;return executeDql<HostEntityRecord>(q);}
async function getBaseSeries(range:TimeRange,ids:string[]){if(!ids.length)return[];const{from,interval}=RANGE_SPEC[range],filter=hostFilter(ids);const run=async(alias:string,metric:string,current:string)=>executeDql<Record<string,unknown>>(`timeseries ${alias}=avg(${metric}), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now() | ${filter} | fieldsAdd ${current}=arrayLast(${alias}) | fields dt.entity.host, ${alias}, ${current}, timeframe, interval`);const[cpu,memory,disk]=await Promise.all([run('cpuSeries','dt.host.cpu.usage','cpuCurrent'),run('memorySeries','dt.host.memory.usage','memoryCurrent'),run('diskSeries','dt.host.disk.used.percent','diskCurrent')]);const map=new Map<string,Record<string,unknown>>();for(const r of[...cpu,...memory,...disk]){const id=hostId(r['dt.entity.host']);if(!id)continue;const cur=map.get(id)??{'dt.entity.host':r['dt.entity.host'],timeframe:r.timeframe,interval:r.interval};Object.assign(cur,r);map.set(id,cur);}return[...map.values()];}
async function getNetwork(range:TimeRange,ids:string[]){if(!ids.length)return new Map<string,Record<string,unknown>>();const{from,interval}=RANGE_SPEC[range],filter=hostFilter(ids);const records=await executeDql<Record<string,unknown>>(`timeseries rx=avg(dt.host.net.nic.bytes_rx), tx=avg(dt.host.net.nic.bytes_tx), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now() | ${filter} | fieldsAdd rxCurrent=arrayLast(rx), txCurrent=arrayLast(tx) | fields dt.entity.host, rx, tx, rxCurrent, txCurrent, timeframe, interval`);return new Map(records.map(r=>[hostId(r['dt.entity.host']),r]));}
async function getThroughput(range:TimeRange,ids:string[]){if(!ids.length)return new Map<string,Record<string,unknown>>();const{from,throughputInterval}=RANGE_SPEC[range],filter=hostFilter(ids);const q=`fetch spans, from:now()-${from}, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) and isNotNull(dt.entity.service) | ${filter} | makeTimeseries throughputSeries=count(), by:{dt.entity.host}, interval:${throughputInterval} | fieldsAdd throughputCurrent=arrayLast(throughputSeries) | fields dt.entity.host, throughputSeries, throughputCurrent, timeframe, interval`;return new Map((await executeDql<Record<string,unknown>>(q)).map(r=>[hostId(r['dt.entity.host']),r]));}
const env=(g:string)=>{const x=g.toLowerCase();if(/\b(dr|disaster|secondary)\b/.test(x))return'DR';if(/\b(uat|test|qa|stage|staging)\b/.test(x))return'UAT';if(/\b(prod|production|prd)\b/.test(x))return'Production';return'Unknown';};
const status=(c:number,m:number,d:number):Host['profile']=>{const x=Math.max(c,m,d);if(x>=90)return'Over Capacity';if(x>=80)return'Near Capacity';if(x>=70)return'Increasing Risk';if(x>=55)return'Stable';return'Healthy';};
export async function getManagementZones():Promise<ManagementZoneOption[]>{const rs=await executeDql<{managementZones?:unknown}>(`fetch dt.entity.host | expand managementZones | filterOut isNull(managementZones) | dedup managementZones | fields managementZones | sort managementZones`);return rs.map(r=>String(r.managementZones??'').trim()).filter(Boolean).map(name=>({name}));}
export async function getHosts(zone?:string,range:TimeRange='24h'):Promise<Host[]>{const entities=await getEntities(zone),ids=entities.map(e=>hostId(e.id)).filter(Boolean);const[base,network,throughput]=await Promise.all([getBaseSeries(range,ids),getNetwork(range,ids),getThroughput(range,ids)]);const bm=new Map(base.map(r=>[hostId(r['dt.entity.host']),r]));return entities.map(e=>{const id=hostId(e.id),b=bm.get(id),n=network.get(id),t=throughput.get(id);const cpu=series(b?.cpuSeries),memory=series(b?.memorySeries),disk=series(b?.diskSeries),rx=series(n?.rx),tx=series(n?.tx),tp=series(t?.throughputSeries);const points=Math.max(cpu.length,memory.length,disk.length,rx.length,tx.length,tp.length,1);const currentCpu=numeric(b?.cpuCurrent)??last(b?.cpuSeries)??0,currentMemory=numeric(b?.memoryCurrent)??last(b?.memorySeries)??0,currentDisk=numeric(b?.diskCurrent)??last(b?.diskSeries)??0,currentRx=numeric(n?.rxCurrent)??last(n?.rx)??0,currentTx=numeric(n?.txCurrent)??last(n?.tx)??0,currentTp=last(t?.throughputSeries)??0;const start=startMs(b?.timeframe??n?.timeframe??t?.timeframe),step=intervalMs(b?.interval??n?.interval??t?.interval),tpScale=Math.max(step/60000,1);const telemetry:TelemetryPoint[]=Array.from({length:points},(_,i)=>({timestamp:new Date(start+i*step).toISOString(),cpu:cpu[i]??Number.NaN,memory:memory[i]??Number.NaN,disk:disk[i]??Number.NaN,networkRx:rx[i]??Number.NaN,networkTx:tx[i]??Number.NaN,throughput:Number.isFinite(tp[i]??Number.NaN)?(tp[i] as number)/tpScale:Number.NaN}));const latest=telemetry[telemetry.length-1];latest.cpu=currentCpu;latest.memory=currentMemory;latest.disk=currentDisk;latest.networkRx=currentRx;latest.networkTx=currentTx;latest.throughput=currentTp/tpScale;const group=String(e.hostGroupName??'').trim(),zones=Array.isArray(e.managementZones)?e.managementZones.map(String):[String(e.managementZones??'')].filter(Boolean);return{id,name:String(e['entity.name']??id),environment:env(group),application:group||'Unclassified host group',profile:status(currentCpu,currentMemory,currentDisk),managementZones:zones,telemetry} satisfies Host;});}
export const dynatraceDataProvider={getHosts,getManagementZones};
