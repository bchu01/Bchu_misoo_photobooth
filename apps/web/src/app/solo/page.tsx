import { PageShell } from '@/components/PageShell';
import { SoloPhotobooth } from '@/features/solo/SoloPhotobooth';

export default function SoloPage() {
  return (
    <PageShell title="Solo">
      <SoloPhotobooth />
    </PageShell>
  );
}
