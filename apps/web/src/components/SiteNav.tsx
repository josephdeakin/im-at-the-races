'use client';

import { usePathname } from 'next/navigation';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';

export function SiteNav() {
  const pathname = usePathname();
  return (
    <TopNav
      heading={<TopNavHeading heading="I'm at the Races" headingHref="/projects" />}
      endContent={
        <Text type="supporting" color="secondary">
          local dev tool
        </Text>
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
