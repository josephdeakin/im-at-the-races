'use client';

import { usePathname } from 'next/navigation';
import { Badge } from '@astryxdesign/core/Badge';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';

export function SiteNav() {
  const pathname = usePathname();
  return (
    <TopNav
      heading={<TopNavHeading heading="I'm at the Races" headingHref="/projects" />}
      endContent={
        <HStack gap={2}>
          <Badge variant="neutral" label="Built on Meta Muse Spark" />
          <Text type="supporting" color="secondary">
            local dev tool
          </Text>
        </HStack>
      }
    >
      <TopNavItem
        href="/projects"
        label="Projects"
        isSelected={pathname === '/' || pathname.startsWith('/projects')}
      />
    </TopNav>
  );
}
