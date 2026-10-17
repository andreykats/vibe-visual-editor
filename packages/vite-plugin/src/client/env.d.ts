declare module 'virtual:vibe-visual-editor/config' {
  const config: { trustedParentOrigins: string[] };
  export default config;
}

interface ImportMeta {
  readonly hot?: {
    on(event: string, cb: (data: unknown) => void): void;
  };
}
