import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiEnhancements } from './uiEnhancements';

export default function EnhancedApp() {
  useEffect(() => {
    installUiEnhancements();
  }, []);
  return <RealAppV2 />;
}
