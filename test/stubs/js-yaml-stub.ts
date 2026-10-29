/**
 * 集成测试专用的 js-yaml stub（format.ts 顶部 import yaml from "js-yaml"）。
 * 测试走默认 json format，yaml 分支不触发；提供可用的 dump/load 兜底以防万一。
 */
const yaml = {
  dump: (v: unknown) => JSON.stringify(v),
  load: (v: string) => JSON.parse(v),
};
export default yaml;
