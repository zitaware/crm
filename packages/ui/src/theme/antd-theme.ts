import type { ThemeConfig } from 'antd';

// Canonical Ant Design ConfigProvider theme — docs/15-ui-design-system.md
// section 7.3 in the Zitaware Solutions palette (ADR-191). Keep in step with
// tailwind-theme.css. Do not scatter hex values through feature components —
// extend this file instead.
export const antdTheme = {
  token: {
    // Primary buttons, selected chips, checkboxes and pagination use the
    // sidebar navy (ink); links stay brand blue so they read as links.
    colorPrimary: '#0a1b4d',
    colorPrimaryHover: '#13296b',
    colorPrimaryActive: '#050f30',
    colorLink: '#0f5bff',
    colorLinkHover: '#0b4de0',
    colorSuccess: '#1f7a52',
    colorWarning: '#b07d1a',
    colorError: '#b23b3b',
    colorInfo: '#2c6390',
    colorText: '#1e293b',
    colorTextSecondary: '#5b6a82',
    colorTextTertiary: '#94a3bb',
    colorBorder: '#e3e8f0',
    colorSplit: '#eef1f5',
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    borderRadius: 7,
    borderRadiusSM: 5,
    controlHeight: 36,
    controlHeightSM: 30,
    fontSize: 14,
    // --font-jakarta is set on <html> by next/font in apps/web layout.tsx.
    fontFamily:
      'var(--font-jakarta), -apple-system, BlinkMacSystemFont, "Segoe UI", ' +
      'Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  components: {
    Layout: {
      bodyBg: '#f5f7fa',
      headerBg: '#ffffff',
      siderBg: '#0a1b4d',
    },
    Menu: {
      darkItemBg: '#0a1b4d',
      darkItemColor: '#c3cce0',
      darkItemHoverBg: '#13296b',
      darkItemSelectedBg: '#13296b',
      darkItemSelectedColor: '#ffffff',
      // docs/15-ui-design-system.md §8.2: "Navigation rows use 7px 18px" —
      // AntD's own Menu defaults never actually matched this; itemHeight
      // approximates 7px padding around 13px/1.4 line-height text, margins
      // zeroed so item spacing comes only from that padding, not an
      // additional AntD-default gap on top of it.
      itemHeight: 32,
      itemPaddingInline: 18,
      itemMarginBlock: 0,
      itemMarginInline: 0,
      collapsedWidth: 72,
    },
    Table: {
      headerBg: '#f5f7fa',
      headerColor: '#5b6a82',
      rowHoverBg: '#fafbfc',
      borderColor: '#e3e8f0',
    },
    Tabs: {
      itemColor: '#5b6a82',
      itemSelectedColor: '#0a1b4d',
      itemActiveColor: '#0a1b4d',
      // Brand yellow marks the active tab; the tab text itself turns navy.
      inkBarColor: '#ffc700',
    },
    Input: {
      activeBorderColor: '#0f5bff',
      hoverBorderColor: '#0f5bff',
      activeShadow: '0 0 0 3px #e8efff',
    },
    Select: {
      activeBorderColor: '#0f5bff',
      hoverBorderColor: '#0f5bff',
      activeOutlineColor: '#e8efff',
    },
  },
} satisfies ThemeConfig;
