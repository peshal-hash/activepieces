import { Badge } from '@/components/ui/badge';

type BetaBadgeProps = {
  showTooltip?: boolean;
};

export const BetaBadge = (_props: BetaBadgeProps) => {
  return <Badge variant="accent">Beta</Badge>;
};
