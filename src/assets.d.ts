// Files imported `with { type: "file" }`: their path (inside the executable, once built).
declare module "*.ttf" {
  const path: string;
  export default path;
}
