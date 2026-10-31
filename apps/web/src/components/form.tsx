import { Banner } from '@astryxdesign/core/Banner';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Banner status="error" title="Something went wrong" description={message} />;
}
