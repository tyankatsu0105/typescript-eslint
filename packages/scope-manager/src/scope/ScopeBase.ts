import {
  TSESTree,
  AST_NODE_TYPES,
} from '@typescript-eslint/experimental-utils';
import { FunctionScope } from './FunctionScope';
import { GlobalScope } from './GlobalScope';
import { ScopeType } from './ScopeType';
import { ScopeManager } from '../ScopeManager';
import { BlockNode, Scope } from './Scope';
import { ModuleScope } from './ModuleScope';
import { Definition, DefinitionType } from '../definition';
import {
  Reference,
  ReferenceFlag,
  ReferenceImplicitGlobal,
} from '../Reference';
import { Variable } from '../Variable';

/**
 * Test if scope is strict
 */
function isStrictScope(
  scope: Scope,
  block: BlockNode,
  isMethodDefinition: boolean,
): boolean {
  let body: TSESTree.BlockStatement | TSESTree.Program | null | undefined;

  // When upper scope is exists and strict, inner scope is also strict.
  if (scope.upper?.isStrict) {
    return true;
  }

  if (isMethodDefinition) {
    return true;
  }

  if (scope.type === ScopeType.class || scope.type === ScopeType.module) {
    return true;
  }

  if (scope.type === ScopeType.block || scope.type === ScopeType.switch) {
    return false;
  }

  if (scope.type === ScopeType.function) {
    const functionBody = block as FunctionScope['block'];
    switch (functionBody.type) {
      case AST_NODE_TYPES.ArrowFunctionExpression:
        if (functionBody.body.type !== AST_NODE_TYPES.BlockStatement) {
          return false;
        }
        body = functionBody.body;
        break;

      case AST_NODE_TYPES.Program:
        body = functionBody;
        break;

      default:
        body = functionBody.body;
    }

    if (!body) {
      return false;
    }
  } else if (scope.type === ScopeType.global) {
    body = block as GlobalScope['block'];
  } else {
    return false;
  }

  // Search 'use strict' directive.
  for (let i = 0, iz = body.body.length; i < iz; ++i) {
    const stmt = body.body[i];

    if (stmt.type !== AST_NODE_TYPES.ExpressionStatement) {
      break;
    }
    const expr = stmt.expression;

    if (
      expr.type !== AST_NODE_TYPES.Literal ||
      typeof expr.value !== 'string'
    ) {
      break;
    }
    if (expr.raw !== null && expr.raw !== undefined) {
      if (expr.raw === '"use strict"' || expr.raw === "'use strict'") {
        return true;
      }
    } else {
      if (expr.value === 'use strict') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Register scope
 */
function registerScope(scopeManager: ScopeManager, scope: Scope): void {
  scopeManager.scopes.push(scope);

  const scopes = scopeManager.nodeToScope.get(scope.block);

  if (scopes) {
    scopes.push(scope);
  } else {
    scopeManager.nodeToScope.set(scope.block, [scope]);
  }
}

/**
 * Should be statically
 */
function shouldBeStatically(def: Definition): boolean {
  return (
    def.type === DefinitionType.ClassName ||
    (def.type === DefinitionType.Variable &&
      def.parent?.type === AST_NODE_TYPES.VariableDeclaration &&
      def.parent.kind !== 'var')
  );
}

type AnyScope = ScopeBase<ScopeType, BlockNode, Scope | null>;
abstract class ScopeBase<
  TType extends ScopeType,
  TBlock extends BlockNode,
  TUpper extends Scope | null
> {
  /**
   * The AST node which created this scope.
   * @public
   */
  public readonly block: TBlock;
  /**
   * The array of child scopes. This does not include grandchild scopes.
   * @public
   */
  public readonly childScopes: Scope[] = [];
  private readonly declaredVariables: WeakMap<TSESTree.Node, Variable[]>;
  /**
   * Generally, through the lexical scoping of JS you can always know which variable an identifier in the source code
   * refers to. There are a few exceptions to this rule. With `global` and `with` scopes you can only decide at runtime
   * which variable a reference refers to.
   * All those scopes are considered "dynamic".
   */
  private dynamic: boolean;
  /**
   * Whether this scope is created by a FunctionExpression.
   * @public
   */
  public readonly functionExpressionScope: boolean = false;
  /**
   * Whether 'use strict' is in effect in this scope.
   * @public
   */
  public isStrict: boolean;
  protected left: Reference[] | null = [];
  /**
   * Any variable {@link Reference} found in this scope.
   * This includes occurrences of local variables as well as variables from parent scopes (including the global scope).
   * For local variables this also includes defining occurrences (like in a 'var' statement).
   * In a 'function' scope this does not include the occurrences of the formal parameter in the parameter list.
   * @public
   */
  public readonly references: Reference[] = [];
  /**
   * The map from variable names to variable objects.
   * @public
   */
  public readonly set = new Map<string, Variable>();
  /**
   * The {@link Reference}s that are not resolved with this scope.
   * @public
   */
  public readonly through: Reference[] = [];
  /**
   * The type of scope
   * @public
   */
  public readonly type: TType;
  /**
   * Reference to the parent {@link Scope}.
   * @public
   */
  public readonly upper: TUpper;
  /**
   * The scoped {@link Variable}s of this scope.
   * In the case of a 'function' scope this includes the automatic argument `arguments` as its first element, as well
   * as all further formal arguments.
   * This does not include variables which are defined in child scopes.
   * @public
   */
  public readonly variables: Variable[] = [];
  /**
   * For 'global', 'function', and 'module' scopes, this is a self-reference.
   * For other scope types this is the *variableScope* value of the parent scope.
   * @public
   */
  public readonly variableScope: GlobalScope | FunctionScope | ModuleScope;

  constructor(
    scopeManager: ScopeManager,
    type: TType,
    upperScope: TUpper,
    block: TBlock,
    isMethodDefinition: boolean,
  ) {
    const upperScopeAsScopeBase = upperScope as Scope;

    this.type = type;
    this.dynamic =
      this.type === ScopeType.global || this.type === ScopeType.with;
    this.block = block;
    this.variableScope =
      this.type === 'global' ||
      this.type === 'function' ||
      this.type === 'module'
        ? (this as AnyScope['variableScope'])
        : upperScopeAsScopeBase.variableScope;
    this.upper = upperScope;

    /**
     * Whether 'use strict' is in effect in this scope.
     * @member {boolean} Scope#isStrict
     */
    this.isStrict = isStrictScope(this as Scope, block, isMethodDefinition);

    if (upperScopeAsScopeBase) {
      // this is guaranteed to be correct at runtime
      upperScopeAsScopeBase.childScopes.push(this as Scope);
    }

    this.declaredVariables = scopeManager.declaredVariables;

    registerScope(scopeManager, this as Scope);
  }

  public shouldStaticallyClose(): boolean {
    return !this.dynamic;
  }

  private shouldStaticallyCloseForGlobal(ref: Reference): boolean {
    // On global scope, let/const/class declarations should be resolved statically.
    const name = ref.identifier.name;

    if (!this.set.has(name)) {
      return false;
    }

    const variable = this.set.get(name);
    const defs = variable?.defs;

    return defs != null && defs.length > 0 && defs.every(shouldBeStatically);
  }

  private staticCloseRef = (ref: Reference): void => {
    const resolve = (): boolean => {
      const name = ref.identifier.name;
      const variable = this.set.get(name);

      if (!variable) {
        return false;
      }

      if (!this.isValidResolution(ref, variable)) {
        return false;
      }
      variable.references.push(ref);
      ref.resolved = variable;

      return true;
    };

    if (!resolve()) {
      this.delegateToUpperScope(ref);
    }
  };

  private dynamicCloseRef = (ref: Reference): void => {
    // notify all names are through to global
    let current = this as Scope | null;

    do {
      current!.through.push(ref);
      current = current!.upper;
    } while (current);
  };

  private globalCloseRef = (ref: Reference): void => {
    // let/const/class declarations should be resolved statically.
    // others should be resolved dynamically.
    if (this.shouldStaticallyCloseForGlobal(ref)) {
      this.staticCloseRef(ref);
    } else {
      this.dynamicCloseRef(ref);
    }
  };

  public close(_scopeManager: ScopeManager): Scope | null {
    let closeRef;

    if (this.shouldStaticallyClose()) {
      closeRef = this.staticCloseRef;
    } else if (this.type !== 'global') {
      closeRef = this.dynamicCloseRef;
    } else {
      closeRef = this.globalCloseRef;
    }

    // Try Resolving all references in this scope.
    for (let i = 0, iz = this.left!.length; i < iz; ++i) {
      const ref = this.left![i];

      closeRef(ref);
    }
    this.left = null;

    return this.upper;
  }

  /**
   * To override by function scopes.
   * References in default parameters isn't resolved to variables which are in their function body.
   */
  protected isValidResolution(_ref: Reference, _variable: Variable): boolean {
    return true;
  }

  protected delegateToUpperScope(ref: Reference): void {
    const upper = (this.upper as Scope) as AnyScope;
    if (upper?.left) {
      upper.left.push(ref);
    }
    this.through.push(ref);
  }

  private addDeclaredVariablesOfNode(
    variable: Variable,
    node: TSESTree.Node | null | undefined,
  ): void {
    if (node == null) {
      return;
    }

    let variables = this.declaredVariables.get(node);

    if (variables == null) {
      variables = [];
      this.declaredVariables.set(node, variables);
    }
    if (!variables.includes(variable)) {
      variables.push(variable);
    }
  }

  protected defineVariable(
    name: string,
    set: Map<string, Variable>,
    variables: Variable[],
    node: TSESTree.Identifier | null,
    def: Definition | null,
  ): void {
    let variable;

    variable = set.get(name);
    if (!variable) {
      variable = new Variable(name, this as Scope);
      set.set(name, variable);
      variables.push(variable);
    }

    if (def) {
      variable.defs.push(def);
      this.addDeclaredVariablesOfNode(variable, def.node);
      this.addDeclaredVariablesOfNode(variable, def.parent);
    }
    if (node) {
      variable.identifiers.push(node);
    }
  }

  public defineIdentifier(
    node: TSESTree.Identifier | null,
    def: Definition,
  ): void {
    if (node) {
      this.defineVariable(node.name, this.set, this.variables, node, def);
    }
  }

  public referencing(
    node: TSESTree.Node,
    assign?: ReferenceFlag,
    writeExpr?: TSESTree.Expression | null,
    maybeImplicitGlobal?: ReferenceImplicitGlobal | null,
    init?: boolean,
  ): void {
    // because Array element may be null
    if (!node || node.type !== AST_NODE_TYPES.Identifier) {
      return;
    }

    // Specially handle like `this`.
    if (node.name === 'super') {
      return;
    }

    const ref = new Reference(
      node,
      this as Scope,
      assign ?? ReferenceFlag.READ,
      writeExpr,
      maybeImplicitGlobal,
      !!init,
    );

    this.references.push(ref);
    this.left?.push(ref);
  }
}

export { ScopeBase };
