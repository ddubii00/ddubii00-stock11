import { SiteAccessGate } from '@/components/site-access-gate';
import { StockDashboard } from '@/components/stock-dashboard';

export default function Home() {
  return <SiteAccessGate><StockDashboard /></SiteAccessGate>;
}
