// DSL 响应接口（避免循环依赖）
interface DslResponse {
  [key: string]: any;
}

// DSL 节点类型定义
interface DslNode {
  type?: string;
  name?: string;
  id?: string;
  path?: any[];
  children?: DslNode[];
  layoutStyle?: any;
  fill?: any;
  strokeColor?: any;
  borderRadius?: any;
  [key: string]: any;
}

interface ParentInfo {
  name?: string;
  type?: string;
  is_icon_container?: boolean;
}

interface SimplificationStats {
  icons_removed: number;
  paths_removed: number;
}

/**
 * DSL 简化器
 * 移除 DSL 中的复杂图标路径数据，将其转换为 ICON_PLACEHOLDER 节点
 */
export class DSLSimplifier {
  // 图标识别规则（优先级从高到低）
  private readonly ICON_NODE_TYPES = new Set(['PATH', 'SVG_ELLIPSE', 'SVG_RECTANGLE', 'VECTOR']);
  private readonly ICON_NAME_KEYWORDS = ['ic-', 'icon', '图标', 'ico_', 'ic_'];
  private readonly ICON_CONTAINER_NAMES = ['点击区', 'clickarea', 'hotspot'];
  
  private stats: SimplificationStats = {
    icons_removed: 0,
    paths_removed: 0,
  };

  /**
   * 简化 DSL 数据（原地修改）
   */
  simplify(dslData: DslResponse): void {
    if (!dslData || typeof dslData !== 'object') {
      return;
    }

    // 重置统计信息
    this.stats = {
      icons_removed: 0,
      paths_removed: 0,
    };

    // 处理 nodes 数组
    if (Array.isArray(dslData.nodes)) {
      dslData.nodes = this._simplifyNodes(dslData.nodes);
    }

    // 添加简化标记
    (dslData as any)._simplified = true;
    (dslData as any)._simplification_stats = { ...this.stats };
  }

  /**
   * 递归简化节点列表
   */
  private _simplifyNodes(nodes: DslNode[], parentInfo?: ParentInfo): DslNode[] {
    const simplifiedNodes: DslNode[] = [];

    for (const node of nodes) {
      const nodeType = node.type || '';
      const nodeName = node.name || '';
      
      // 检查是否为图标节点
      const isIcon = this._isIconNode(node, parentInfo, nodeType, nodeName);

      if (isIcon) {
        // 简化图标节点
        const simplifiedNode = this._simplifyIconNode(node, nodeType, nodeName);
        simplifiedNodes.push(simplifiedNode);
        this.stats.icons_removed += 1;
      } else {
        // 递归处理子节点
        if (Array.isArray(node.children) && node.children.length > 0) {
          const parentContext: ParentInfo = {
            name: nodeName,
            type: nodeType,
            is_icon_container: this._isIconContainerCached(nodeName),
          };
          node.children = this._simplifyNodes(node.children, parentContext);
        }
        
        simplifiedNodes.push(node);
      }
    }

    return simplifiedNodes;
  }

  /**
   * 判断节点是否为图标
   */
  private _isIconNode(
    node: DslNode,
    parentInfo?: ParentInfo,
    nodeType?: string,
    nodeName?: string
  ): boolean {
    const type = (nodeType ?? node.type) || '';
    const name = (nodeName ?? node.name) || '';
    const nameLower = name.toLowerCase();

    // 规则 1: 节点类型是图标类型
    if (type && this.ICON_NODE_TYPES.has(type)) {
      return true;
    }

    // 规则 2: 包含 path 数据
    const pathData = node.path;
    if (Array.isArray(pathData) && pathData.length > 0) {
      this.stats.paths_removed += pathData.length;
      return true;
    }

    // 规则 3: 名称包含图标关键词
    for (const keyword of this.ICON_NAME_KEYWORDS) {
      if (nameLower.includes(keyword)) {
        return true;
      }
    }

    // 规则 4: 父节点是图标容器
    if (parentInfo?.is_icon_container) {
      return true;
    }

    // 规则 5: GROUP 类型且包含 PATH 子节点
    if (type === 'GROUP' && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child.type && this.ICON_NODE_TYPES.has(child.type)) {
          return true;
        }
      }
    }

    // 规则 6: LAYER 类型且名称为点击区
    if (type === 'LAYER') {
      for (const keyword of this.ICON_CONTAINER_NAMES) {
        if (nameLower.includes(keyword)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 判断节点名称是否为图标容器（优化版）
   */
  private _isIconContainerCached(nodeName: string): boolean {
    const nameLower = nodeName.toLowerCase();
    for (const keyword of this.ICON_NAME_KEYWORDS) {
      if (nameLower.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 简化单个图标节点
   */
  private _simplifyIconNode(
    node: DslNode,
    nodeType?: string,
    nodeName?: string
  ): DslNode {
    const type = (nodeType ?? node.type) || '';
    const name = (nodeName ?? node.name) || 'icon';
    const nodeId = node.id || '';

    const simplified: DslNode = {
      type: 'ICON_PLACEHOLDER',
      id: nodeId,
      name: name,
      layoutStyle: node.layoutStyle || {},
      _original_type: type,
      _is_simplified: true,
      _placeholder_comment: `TODO: 替换为实际图标资源 (${name})`,
    };

    // 保留必要的样式信息（用于占位）
    if (node.fill !== undefined) {
      simplified._original_fill = node.fill;
    }

    if (node.strokeColor !== undefined) {
      simplified._original_stroke = node.strokeColor;
    }

    if (node.borderRadius !== undefined) {
      simplified.borderRadius = node.borderRadius;
    }

    return simplified;
  }
}

// 创建简化器实例（单例模式，可复用）
export const dslSimplifier = new DSLSimplifier();
