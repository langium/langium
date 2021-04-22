import { AbstractElement, Action, Alternatives, Assignment, CrossReference, Grammar, Group, Keyword, ParserRule, RuleCall, TerminalRule, UnorderedGroup } from "../gen/ast";
import { getTypeName } from "../grammar/grammar-utils";
import { CompositeGeneratorNode, GeneratorNode, IndentNode, NewLineNode } from "./node/node";
import { process } from "./node/node-processor";
import { replaceTokens } from "./token-replacer";
import { collectAst } from "./type-collector";
import { findAllFeatures } from "./utils";

type RuleContext = {
    name: string,
    option: number,
    consume: number,
    subrule: number,
    many: number,
    or: number,
    featureMap: Map<AbstractElement, string>
}

export function generateParser(grammar: Grammar, path?: string): string {
    const keywords = collectKeywords(grammar);
    const langiumPath = "'" + (path ?? 'langium') + "'";

    const fileNode = new CompositeGeneratorNode();
    fileNode.children.push(
        '/* eslint-disable */',
        new NewLineNode(),
        '// @ts-nocheck',
        new NewLineNode(),
        "import { createToken, Lexer } from 'chevrotain';",
        new NewLineNode(),
        'import { LangiumParser } from ', langiumPath, ';',
        new NewLineNode(),
        'import { ' + grammar.name + "GrammarAccess } from './grammar-access';",
        new NewLineNode(),
    );

    fileNode.children.push('import {');
    const types = collectAst(grammar);
    types.forEach(e => {
        fileNode.children.push(' ', e.name, ',');
    });
    fileNode.children.push(" } from './ast';", new NewLineNode(), new NewLineNode());

    const tokens: Array<{ name: string, length: number, node: CompositeGeneratorNode }> = [];
    const terminals = grammar.rules?.filter(e => TerminalRule.is(e)).map(e => e as TerminalRule);

    terminals.forEach(e => {
        tokens.push(buildTerminalToken(grammar, e));
    });
    let keywordTokens: Array<{ name: string, length: number, node: CompositeGeneratorNode }> = [];
    keywords.forEach(e => {
        keywordTokens.push(buildKeywordToken(e, keywords, terminals));
    });
    keywordTokens = keywordTokens.sort((a, b) => b.length - a.length);
    tokens.forEach(e => {
        fileNode.children.push(e.node, new NewLineNode());
    });
    keywordTokens.forEach(e => {
        fileNode.children.push(e.node, new NewLineNode());
    });

    fileNode.children.push(new NewLineNode());

    keywords.forEach(e => {
        const token = buildKeywordToken(e, keywords, terminals);
        fileNode.children.push(
            token.name, '.LABEL = "', "'", e.substring(1, e.length - 1), "'\";",
            new NewLineNode()
        );
    })

    const tokenListNode = new CompositeGeneratorNode();
    tokenListNode.children.push(
        'const tokens = [',
        keywordTokens.map(e => e.name).join(', ') + ', ' + tokens.map(e => e.name).join(', '),
        '];',
        new NewLineNode()
    );

    fileNode.children.push(tokenListNode, new NewLineNode());
    fileNode.children.push('const lexer = new Lexer(tokens);', new NewLineNode());

    fileNode.children.push(buildParser(grammar), new NewLineNode(), new NewLineNode());

    fileNode.children.push('let parser: Parser | undefined;', new NewLineNode(), new NewLineNode());

    fileNode.children.push(buildParseFunction(grammar));
    return process(fileNode);
}

function buildParseFunction(grammar: Grammar): CompositeGeneratorNode {
    const parseFunction = new CompositeGeneratorNode();
    parseFunction.children.push(
        'export function parse(grammarAccess: ', grammar.name, 'GrammarAccess, text: string) {', new NewLineNode());
    const parseBody = new IndentNode();
    parseBody.children.push(
        'if (!parser) {', new NewLineNode(),
        '    parser = new Parser(grammarAccess);', new NewLineNode(), '}', new NewLineNode(),
        'const lexResult = lexer.tokenize(text);', new NewLineNode(),
        'parser.input = lexResult.tokens;', new NewLineNode(),
        'const ast = parser.parse(text);', new NewLineNode(),
        'return {', new NewLineNode()
    );

    const resultObj = new IndentNode();
    resultObj.children.push(
        'ast,', new NewLineNode(),
        'lexErrors: lexResult.errors,', new NewLineNode(),
        'parseErrors: parser.errors', new NewLineNode()
    );

    parseBody.children.push(resultObj, '}', new NewLineNode());
    parseFunction.children.push(parseBody, '}', new NewLineNode());
    return parseFunction;
}

function buildParser(grammar: Grammar): CompositeGeneratorNode {
    const parserNode = new CompositeGeneratorNode();

    parserNode.children.push('export class Parser extends LangiumParser {', new NewLineNode());

    const classBody = new IndentNode();
    classBody.children.push('grammarAccess: ', grammar.name, 'GrammarAccess;', new NewLineNode());
    classBody.children.push('constructor(grammarAccess: ', grammar.name, 'GrammarAccess) {', new NewLineNode());

    const constructorBody = new IndentNode();
    constructorBody.children.push(
        'super(tokens);',
        new NewLineNode(),
        'this.grammarAccess = grammarAccess;',
        new NewLineNode(),
        'this.performSelfAnalysis();',
        new NewLineNode()
    );

    classBody.children.push(
        constructorBody, '}',
        new NewLineNode(),
        new NewLineNode()
    )

    let first = true;
    grammar.rules?.filter(e => ParserRule.is(e)).map(e => e as ParserRule).forEach(e => {
        const ctx: RuleContext = {
            name: e.name,
            consume: 1,
            option: 1,
            subrule: 1,
            many: 1,
            or: 1,
            featureMap: findAllFeatures(e).byFeature
        };
        classBody.children.push(buildRule(ctx, e, first));
        first = false;
    });

    parserNode.children.push(classBody, '}');

    return parserNode;
}

function buildRule(ctx: RuleContext, rule: ParserRule, first: boolean): CompositeGeneratorNode {
    const ruleNode = new CompositeGeneratorNode();
    ruleNode.children.push('private ', rule.name);

    ruleNode.children.push(
        ' = this.', first ? 'MAIN_RULE("' : 'DEFINE_RULE("',
        rule.name, '", ', rule.fragment ? 'undefined' : getTypeName(rule) + '.kind',
        ', () => {',
        new NewLineNode()
    );

    const ruleContent = new IndentNode();
    ruleNode.children.push(ruleContent);
    ruleContent.children.push(buildElement(ctx, rule.alternatives), new NewLineNode(undefined, true));
    ruleContent.children.push(buildRuleReturnStatement(rule));

    ruleNode.children.push(
        '})',
        new NewLineNode(),
        new NewLineNode()
    )

    return ruleNode;
}

function buildRuleReturnStatement(rule: ParserRule): CompositeGeneratorNode {
    const node = new CompositeGeneratorNode();
    node.children.push('return this.construct<', getTypeName(rule), '>();', new NewLineNode(undefined, true));
    return node;
}

function buildUnorderedGroup(ctx: RuleContext, group: UnorderedGroup, assignment?: Assignment): CompositeGeneratorNode {
    if (Group.is(group)) {
        return buildGroup(ctx, group, assignment);
    } else {
        throw new Error('Unordered groups are not supported (yet)');
    }
}

function buildGroup(ctx: RuleContext, group: Group, assignment?: Assignment): CompositeGeneratorNode {
    const groupNode = new CompositeGeneratorNode();

    group.elements.forEach(e => {
        const terminalNode = buildElement(ctx, e, assignment);
        groupNode.children.push(wrap(ctx, terminalNode, e.cardinality), new NewLineNode(undefined, true));
    });

    return groupNode;
}

function buildAction(ctx: RuleContext, action: Action): GeneratorNode {
    return 'this.executeAction(' + action.Type + '.kind, ' + getGrammarAccess(ctx, action) + ');';
}

function buildElement(ctx: RuleContext, terminal: AbstractElement, assignment?: Assignment): GeneratorNode {
    if (Keyword.is(terminal)) {
        return buildKeyword(ctx, terminal, assignment);
    } else if (Action.is(terminal)) {
        return buildAction(ctx, terminal);
    } else if (Assignment.is(terminal)) {
        return buildElement(ctx, terminal.terminal, terminal);
    } else if (CrossReference.is(terminal)) {
        return 'this.consumeLeaf(' + ctx.consume++ + ', ID, ' + getGrammarAccess(ctx, assignment ?? terminal) + ');';
    } else if (RuleCall.is(terminal)) {
        return buildRuleCall(ctx, terminal, assignment);
    } else if (Alternatives.is(terminal)) {
        return buildAlternatives(ctx, terminal, assignment);
    } else if (UnorderedGroup.is(terminal)) {
        return buildUnorderedGroup(ctx, terminal, assignment);
    } else if (Group.is(terminal)) {
        return buildGroup(ctx, terminal, assignment);
    } else {
        return "";
    }
}

function buildAlternatives(ctx: RuleContext, element: Alternatives, assignment?: Assignment): GeneratorNode {
    if (element.elements.length === 1) {
        return buildElement(ctx, element.elements[0], assignment);
    } else {
        const wrapper = new CompositeGeneratorNode();
        wrapper.children.push('this.or(', (ctx.or++).toString(), ', [', new NewLineNode());
        const altWrapper = new IndentNode();
        wrapper.children.push(altWrapper);
        element.elements.forEach(e => {
            altWrapper.children.push('{', new NewLineNode());
            const altIndent = new IndentNode();
            const contentIndent = new IndentNode();
            altIndent.children.push('ALT: () => {', new NewLineNode(), contentIndent, '}', new NewLineNode());
            const elementNode = buildElement(ctx, e, assignment);
            contentIndent.children.push(wrap(ctx, elementNode, e.cardinality), new NewLineNode(undefined, true));
            altWrapper.children.push(altIndent, '},', new NewLineNode());
        });

        wrapper.children.push(']);', new NewLineNode());

        return wrapper;
    }
}

function wrap<T extends GeneratorNode>(ctx: RuleContext, node: T, cardinality: string | undefined): T | CompositeGeneratorNode {
    if (!cardinality) {
        return node;
    } else {
        const wrapper = new CompositeGeneratorNode();
        if (cardinality === '*' || cardinality === '+') {
            wrapper.children.push('this.many(' + ctx.many++ + ', () => {', new NewLineNode());
        } else if (cardinality === '?') {
            wrapper.children.push('this.option(' + ctx.option++ + ', () => {', new NewLineNode());
        }

        const indent = new IndentNode();
        indent.children.push(node, new NewLineNode(undefined, true));
        wrapper.children.push(indent, '});');

        return wrapper;
    }
}

function buildRuleCall(ctx: RuleContext, ruleCall: RuleCall, assignment?: Assignment): string {
    if (ParserRule.is(ruleCall.rule)) {
        if (assignment) {
            return 'this.subruleLeaf(' + ctx.subrule++ + ', this.' + ruleCall.rule.name + ', ' + getGrammarAccess(ctx, assignment) + ');';
        } else {
            return 'this.unassignedSubrule(' + ctx.subrule++ + ', this.' + ruleCall.rule.name + ', ' + getGrammarAccess(ctx, ruleCall) + ');';
        }
    } else if (TerminalRule.is(ruleCall.rule)) {
        return 'this.consumeLeaf(' + ctx.consume++ + ', ' + ruleCall.rule.name + ', ' + getGrammarAccess(ctx, assignment ?? ruleCall) + ');';
    }

    return "";
}

function buildKeyword(ctx: RuleContext, keyword: Keyword, assignment?: Assignment): string {
    const validName = replaceTokens(keyword.value) + 'Keyword';
    const node = 'this.consumeLeaf(' + ctx.consume++ + ', ' + validName + ', ' + getGrammarAccess(ctx, assignment ?? keyword) + ');';
    return node;
}

function getGrammarAccess(ctx: RuleContext, feature: AbstractElement): string {
    return 'this.grammarAccess.' + ctx.name + '.' + ctx.featureMap.get(feature);
}

function buildTerminalToken(grammar: Grammar, terminal: TerminalRule): { name: string, length: number, node: CompositeGeneratorNode } {
    const terminalNode = new CompositeGeneratorNode();
    terminalNode.children.push(
        'const ',
        terminal.name,
        " = createToken({ name : '",
        terminal.name,
        "', pattern: ",
        terminal.regex);

    if (grammar.hiddenTokens && grammar.hiddenTokens.includes(terminal)) {
        terminalNode.children.push(', group: Lexer.SKIPPED');
    }

    terminalNode.children.push(' });');

    return { name: terminal.name, length: terminal.regex.length, node: terminalNode };
}

function buildKeywordToken(keyword: string, keywords: string[], terminals: TerminalRule[]): { name: string, length: number, node: CompositeGeneratorNode } {
    const keywordNode = new CompositeGeneratorNode();
    const fixed = keyword.substring(1, keyword.length - 1);
    const longerAlt = findLongerAlt(fixed, keywords, terminals);
    const validName = replaceTokens(keyword) + 'Keyword';
    keywordNode.children.push(
        'const ',
        validName,
        " = createToken({ name: '",
        validName,
        "', pattern: /",
        escapeRegExp(fixed),
        '/');

    if (longerAlt) {
        keywordNode.children.push(', longer_alt: ', longerAlt);
    }

    keywordNode.children.push(' });');
    return { name: validName, length: keyword.length, node: keywordNode };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLongerAlt(keyword: string, keywords: string[], terminals: TerminalRule[]): string | undefined {
    const starter = "'" + keyword
    const longerKeywords = keywords.filter(e => e.length > keyword.length + 2 && e.startsWith(starter));
    if (longerKeywords.length > 0) {
        let shortest = longerKeywords[0];
        for (const key of longerKeywords) {
            if (key.length < shortest.length) {
                shortest = key;
            }
        }
        return replaceTokens(shortest) + 'Keyword';
    }
    // TODO: for now, just return id
    return terminals.find(e => e.name === 'ID')?.name;
}

function collectKeywords(grammar: Grammar): string[] {
    const keywords = new Set<string>();

    grammar.rules?.filter(e => ParserRule.is(e)).map(e => e as ParserRule).forEach(r => {
        collectElementKeywords(r.alternatives, keywords);
    });

    return Array.from(keywords);
}

function collectElementKeywords(element: AbstractElement, keywords: Set<string>) {
    if (Alternatives.is(element) || Group.is(element) || UnorderedGroup.is(element)) {
        element.elements.forEach(e => {
            collectElementKeywords(e, keywords);
        });
    } else if (Assignment.is(element)) {
        collectElementKeywords(element.terminal, keywords);
    } else if (Keyword.is(element)) {
        keywords.add(element.value);
    }
}
