/**
 * 集成测试专用的 api 层 stub（顶替 src/utils/api.ts）。
 *
 * 原 api.ts 依赖 axios/https-proxy-agent 并在模块级配置代理；集成测试不真发请求，
 * 用可编程 fixtures 直接返回。工具文件统一以 "../utils/api" 说明符导入，由
 * test/build-integration.mjs 的 esbuild alias 映射到本文件。
 *
 * 用法：测试内直接改 integrationFixtures 的字段；calls 记录全部调用参数供断言。
 */

export interface IntegrationFixtures {
  /** getPageLayers 的返回（非空 layers 才会触发建计划） */
  pageLayers?: any;
  /** getDesignSections：list 模式（无 sectionIndex）返回 */
  designSectionsList?: any;
  /** getDesignSections：DSL 模式返回 */
  designSectionsDsl?: any;
  /** 设置后 getDesignSections 抛出该错误（模拟 10017 等） */
  designSectionsError?: any;
  /** applyDesign 的返回（必须含 patchedCode） */
  applyDesign?: any;
}

export const integrationFixtures: IntegrationFixtures = {};

export const integrationCalls: Array<Record<string, unknown>> = [];

export function resetIntegrationFixtures(): void {
  for (const k of Object.keys(integrationFixtures) as Array<keyof IntegrationFixtures>) {
    delete integrationFixtures[k];
  }
  integrationCalls.length = 0;
}

export const httpUtilInstance = {
  async getPageLayers(fileId: string, layerId: string) {
    integrationCalls.push({ method: "getPageLayers", fileId, layerId });
    return integrationFixtures.pageLayers;
  },

  async getDesignSections(
    fileId: string,
    layerId: string,
    sectionIndex?: number,
    fromPageParam?: boolean,
  ) {
    integrationCalls.push({ method: "getDesignSections", fileId, layerId, sectionIndex, fromPageParam });
    if (integrationFixtures.designSectionsError) throw integrationFixtures.designSectionsError;
    return sectionIndex === undefined
      ? integrationFixtures.designSectionsList
      : integrationFixtures.designSectionsDsl;
  },

  async applyDesign(
    code: string,
    fileId: string,
    layerId: string,
    sourceLayerId?: string,
    targetLang?: string,
  ) {
    integrationCalls.push({ method: "applyDesign", fileId, layerId, sourceLayerId, targetLang, codeLen: code.length });
    return integrationFixtures.applyDesign;
  },

  // 以下方法集成测试不应触达，触达即失败（尽早暴露误接线）。
  async extractIdsFromUrl(): Promise<never> {
    throw new Error("extractIdsFromUrl not expected in integration test");
  },
  async getDsl(): Promise<never> {
    throw new Error("getDsl not expected in integration test");
  },
  async getMeta(): Promise<never> {
    throw new Error("getMeta not expected in integration test");
  },
  async extractSvg(): Promise<never> {
    throw new Error("extractSvg not expected in integration test");
  },
  async getPageData(): Promise<never> {
    throw new Error("getPageData not expected in integration test");
  },
};
