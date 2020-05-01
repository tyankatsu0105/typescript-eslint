import { TSESTree } from '@typescript-eslint/experimental-utils';
import { Visitor as ESRecurseVisitor } from 'esrecurse';

type FallbackFn = (node: {}) => string[];
interface VisitorKeys {
  readonly [type: string]: ReadonlyArray<string> | undefined;
}
interface VisitorOptions {
  processRightHandNodes?: boolean;
  childVisitorKeys?: VisitorKeys | null;
  fallback?: 'iteration' | 'none' | FallbackFn;
}

declare class ESRecurseVisitorType {
  constructor(visitor: ESRecurseVisitorType | null, options: VisitorOptions);

  /**
   * Default method for visiting children.
   * When you need to call default visiting operation inside custom visiting
   * operation, you can use it with `this.visitChildren(node)`.
   */
  visitChildren(node: TSESTree.Node): void;

  /**
   * Dispatching node.
   */
  visit(node: TSESTree.Node | null): void;
}
class Visitor extends (ESRecurseVisitor as typeof ESRecurseVisitorType) {}

export { Visitor, VisitorOptions, VisitorKeys };
