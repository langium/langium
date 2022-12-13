/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { createLangiumGrammarServices, Grammar, EmptyFileSystem, s } from '../../../src';
import { isParserRule } from '../../../src/grammar/generated/ast';
import { isDataTypeRule } from '../../../src/grammar/internal-grammar-util';
import { collectAst, specifyAstNodeProperties } from '../../../src/grammar/type-system/ast-collector';
import { collectAllAstResources } from '../../../src/grammar/type-system/type-collector/all-types';
import { collectDeclaredTypes } from '../../../src/grammar/type-system/type-collector/declared-types';
import { collectInferredTypes } from '../../../src/grammar/type-system/type-collector/inferred-types';
import { AstTypes, InterfaceType, Property, PropertyType, UnionType } from '../../../src/grammar/type-system/type-collector/types';
import { sortInterfacesTopologically } from '../../../src/grammar/type-system/types-util';
import { parseHelper } from '../../../src/test';

function describeTypes(name: string, grammar: string, description: (types: AstTypes) => void | Promise<void>): void {
    describe(name, () => {
        const types: AstTypes = {
            interfaces: [],
            unions: []
        };
        beforeAll(async () => {
            const newTypes = await getTypes(grammar);
            types.interfaces = newTypes.interfaces;
            types.unions = newTypes.unions;
        });
        description.call(undefined, types);
    });
}

describeTypes('inferred types of simple grammars', `
    A: name=ID value=NUMBER?;
    B: name=FQN values+=NUMBER;
    C: 'c' ref=[A];

    FQN: ID;
    terminal ID returns string: /string/;
    terminal NUMBER returns number: /number/;
`, types => {
    test('A is inferred with name:string and value?:number', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeDefined();
        expectProperty(a, {
            name: 'name',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
        expectProperty(a, {
            name: 'value',
            optional: true,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['number']
            }],
            astNodes: new Set(),
        });
    });

    test('B is inferred with name:FQN and values:number[]', () => {
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeDefined();
        expectProperty(b, {
            name: 'name',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['FQN'],
            }],
            astNodes: new Set(),
        });
        expectProperty(b, {
            name: 'values',
            optional: false,
            typeAlternatives: [{
                array: true,
                reference: false,
                types: ['number']
            }],
            astNodes: new Set(),
        });
    });

    test('C is inferred with ref:@A', () => {
        const c = getType(types, 'C') as InterfaceType;
        expect(c).toBeDefined();
        expectProperty(c, {
            name: 'ref',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: true,
                types: ['A']
            }],
            astNodes: new Set(),
        });
    });

    test('FQN is created as an union type', () => {
        const fqn = getType(types, 'FQN') as UnionType;
        expectUnion(fqn, [
            {
                array: false,
                reference: false,
                types: ['string']
            }
        ]);
    });
});

describeTypes('inferred types for alternatives', `
    A: name=ID | name=NUMBER;
    B: name=(ID | NUMBER);
    C: A | B;
    D: A | B | name=ID;
    E: name=ID | value=NUMBER;


    terminal ID returns string: /string/;
    terminal NUMBER returns number: /number/;
`, types => {
    test('A is inferred with name:(string)|(number)', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeDefined();
        expect(a.printingSuperTypes).toEqual(['D']);
        expect(a.properties).toHaveLength(1);
        expectProperty(a, {
            name: 'name',
            optional: false,
            typeAlternatives: [
                {
                    array: false,
                    reference: false,
                    types: ['string']
                },
                {
                    array: false,
                    reference: false,
                    types: ['number']
                }
            ],
            astNodes: new Set(),
        });
    });

    test('B is inferred with name:(number|string)', () => {
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeDefined();
        expect(b.printingSuperTypes).toEqual(['D']);
        expect(b.properties).toHaveLength(1);
        expectProperty(b, {
            name: 'name',
            optional: false,
            typeAlternatives: [
                {
                    array: false,
                    reference: false,
                    types: ['string']
                },
                {
                    array: false,
                    reference: false,
                    types: ['number']
                }
            ],
            astNodes: new Set(),
        });
    });

    test('C is inferred as union type A | B', () => {
        const c = getType(types, 'C') as UnionType;
        expect(c).toBeDefined();
        expectUnion(c, [
            {
                array: false,
                reference: false,
                types: ['A']
            },
            {
                array: false,
                reference: false,
                types: ['B']
            }
        ]);
    });

    test('D is inferred as name:string', () => {
        const d = getType(types, 'D') as InterfaceType;
        expect(d).toBeDefined();
        expect(d.printingSuperTypes).toHaveLength(0);
        expect(d.properties).toHaveLength(1);
        expectProperty(d, {
            name: 'name',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
    });

    test('E is inferred with name?:string, value?: number', () => {
        const e = getType(types, 'E') as InterfaceType;
        expect(e).toBeDefined();
        expectProperty(e, {
            name: 'name',
            optional: true,
            typeAlternatives: [
                {
                    array: false,
                    reference: false,
                    types: ['string']
                }
            ],
            astNodes: new Set(),
        });
        expectProperty(e, {
            name: 'value',
            optional: true,
            typeAlternatives: [
                {
                    array: false,
                    reference: false,
                    types: ['number']
                }
            ],
            astNodes: new Set(),
        });
    });

});

describeTypes('inferred types using chained actions', `
    A: a=ID ({infer B} b=ID ({infer C} c=ID)?)? d=ID;
	D: E ({infer D.e=current} d=ID)?;
    E: e=ID;
    F: value=ID ({infer F.item=current} value=ID)*;
    G: ({infer X} x=ID | {infer Y} y=ID | {infer Z} z=ID) {infer G.front=current} back=ID;

    Entry:
	    Expr;
    Expr:
        {infer Ref} ref=ID
        ({infer Access.receiver=current} '.' member=ID)*;
    Ref:
        {infer Ref} ref=ID;
    Access:
        {infer Access} '.' member=ID;

    IdRule:
        'id' name=ID;
    RuleName infers RuleType:
        IdRule (
            {infer FirstBranch.value=current} FirstBranchFragment
        |   {infer SecondBranch.value=current} SecondBranchFragment
        );
    fragment FirstBranchFragment: 'First' first=ID;
    fragment SecondBranchFragment: 'Second' second=ID;

    terminal ID returns string: /string/;
`, types => {

    test('RuleType is inferred as a union type', () => {
        const ruleType = getType(types, 'RuleType') as UnionType;
        expect(ruleType).toBeDefined();
        expectUnion(ruleType, [
            {
                array: false,
                reference: false,
                types: ['IdRule']
            },
            {
                array: false,
                reference: false,
                types: ['FirstBranch']
            },
            {
                array: false,
                reference: false,
                types: ['SecondBranch']
            },
        ]);
    });

    test('FirstBranch is inferred as first:string, value:IdRule', () => {
        const firstBranch = getType(types, 'FirstBranch') as InterfaceType;
        expect(firstBranch).toBeDefined();
        expect(firstBranch.printingSuperTypes).toHaveLength(0);
        expect(firstBranch.properties).toHaveLength(2);
        expectProperty(firstBranch, {
            name: 'first',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
        expectProperty(firstBranch, {
            name: 'value',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['IdRule']
            }],
            astNodes: new Set(),
        });

    });

    test('Entry is inferred as a union type', () => {
        const entry = getType(types, 'Entry') as UnionType;
        expect(entry).toBeDefined();
        expectUnion(entry, [{
            array: false,
            reference: false,
            types: ['Expr']
        }]);
    });

    test('Expr is inferred as a union type', () => {
        const expr = getType(types, 'Expr') as UnionType;
        expect(expr).toBeDefined();
        expectUnion(expr, [
            {
                array: false,
                reference: false,
                types: ['Ref']
            },
            {
                array: false,
                reference: false,
                types: ['Access']
            },
        ]);
    });

    test('Ref is inferred as ref:string', () => {
        const ref = getType(types, 'Ref') as InterfaceType;
        expect(ref).toBeDefined();
        expect(ref.printingSuperTypes).toHaveLength(0);
        expect(ref.properties).toHaveLength(1);
        expectProperty(ref, {
            name: 'ref',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
    });

    test('Access is inferred as receiver:Ref, member:string', () => {
        const access = getType(types, 'Access') as InterfaceType;
        expect(access).toBeDefined();
        expect(access.printingSuperTypes).toHaveLength(0);
        expect(access.properties).toHaveLength(2);
        expectProperty(access, {
            name: 'receiver',
            optional: true,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['Ref']
            }],
            astNodes: new Set(),
        });
        expectProperty(access, {
            name: 'member',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
    });

    test('A is inferred with a:string, d:string', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeDefined();
        expect(a.printingSuperTypes).toHaveLength(0);
        expect(a.properties).toHaveLength(2);
        expectProperty(a, 'a');
        expectProperty(a, 'd');
    });

    test('B is inferred with super type A and a:string, b:string, d:string', () => {
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeDefined();
        expect(b.printingSuperTypes).toEqual(['A']);
        expect(b.properties).toHaveLength(3);
        expectProperty(b, 'a');
        expectProperty(b, 'b');
        expectProperty(b, 'd');
    });

    test('C is inferred with super type B and a:string, b:string, c:string d:string', () => {
        const c = getType(types, 'C') as InterfaceType;
        expect(c).toBeDefined();
        expect(c.printingSuperTypes).toEqual(['B']);
        expect(c.properties).toHaveLength(4);
        expectProperty(c, 'a');
        expectProperty(c, 'b');
        expectProperty(c, 'c');
        expectProperty(c, 'd');
    });

    test('D is inferred with e:E, d:string', () => {
        const d = getType(types, 'D') as InterfaceType;
        expect(d).toBeDefined();
        expect(d.printingSuperTypes).toHaveLength(0);
        expect(d.properties).toHaveLength(2);
        expectProperty(d, {
            name: 'e',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['E']
            }],
            astNodes: new Set(),
        });
        expectProperty(d, 'd');
    });

    test('E is inferred with super type D and property e', () => {
        const e = getType(types, 'E') as InterfaceType;
        expect(e).toBeDefined();
        expect(e.printingSuperTypes).toEqual(['D']);
        expect(e.properties).toHaveLength(1);
        expectProperty(e, 'e');
    });

    test('F is inferred with value:string, item?:F', () => {
        const f = getType(types, 'F') as InterfaceType;
        expect(f).toBeDefined();
        expect(f.printingSuperTypes).toHaveLength(0);
        expect(f.properties).toHaveLength(2);
        expectProperty(f, 'value');
        expectProperty(f, {
            name: 'item',
            optional: true,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['F']
            }],
            astNodes: new Set(),
        });
    });

    test('G is inferred with front:(X|Y|Z), back:string', () => {
        const G = getType(types, 'G') as InterfaceType;
        expect(G).toBeDefined();
        expect(G.printingSuperTypes).toHaveLength(0);
        expect(G.properties).toHaveLength(2);
        expectProperty(G, {
            name: 'front',
            optional: false,
            typeAlternatives: [
                {
                    array: false,
                    reference: false,
                    types: ['X']
                },
                {
                    array: false,
                    reference: false,
                    types: ['Y']
                },
                {
                    array: false,
                    reference: false,
                    types: ['Z']
                }
            ],
            astNodes: new Set(),
        });
    });

    test('X, Y, Z are inferred from G as simple types', () => {
        const x = getType(types, 'X') as InterfaceType;
        expect(x).toBeDefined();
        expect(x.printingSuperTypes).toEqual(['G']);
        expect(x.properties).toHaveLength(1);
        expectProperty(x, 'x');
        const y = getType(types, 'Y') as InterfaceType;
        expect(y).toBeDefined();
        expect(x.printingSuperTypes).toEqual(['G']);
        expect(y.properties).toHaveLength(1);
        expectProperty(y, 'y');
        const z = getType(types, 'Z') as InterfaceType;
        expect(z).toBeDefined();
        expect(x.printingSuperTypes).toEqual(['G']);
        expect(z.properties).toHaveLength(1);
        expectProperty(z, 'z');
    });

});

describeTypes('inferred types with common names', `
    A infers X: a=ID;
	B infers X: a=ID b=ID;
    C infers X: a=ID c=ID?;

    terminal ID returns string: /string/;
`, types => {
    test('X is inferred with a:string, b?:string, c?:string', () => {
        const x = getType(types, 'X') as InterfaceType;
        expect(x).toBeDefined();
        expect(x.printingSuperTypes).toHaveLength(0);
        expect(x.properties).toHaveLength(3);
        expectProperty(x, 'a');
        expectProperty(x, {
            name: 'b',
            optional: true,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
        expectProperty(x, {
            name: 'c',
            optional: true,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['string']
            }],
            astNodes: new Set(),
        });
    });

    test('A, B, C are not inferred', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeUndefined();
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeUndefined();
        const c = getType(types, 'C') as InterfaceType;
        expect(c).toBeUndefined();
    });

});

describeTypes('inferred types with common names and actions', `
    A infers X: {infer A} a=ID;
	B infers X: {infer B} b=ID;

    C: D ({infer C.item=current} value=ID);
    D infers Y: y=ID;

    terminal ID returns string: /string/;
`, types => {
    test('A is inferred with a:string', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeDefined();
        // Since 'X' is not an actual type (but a union), it is removed as a super type.
        expect(a.printingSuperTypes).toHaveLength(0);
        expect(a.properties).toHaveLength(1);
        expectProperty(a, 'a');
    });

    test('B is inferred with b:string', () => {
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeDefined();
        // Since 'X' is not an actual type (but a union), it is removed as a super type.
        expect(b.printingSuperTypes).toHaveLength(0);
        expect(b.properties).toHaveLength(1);
        expectProperty(b, 'b');
    });

    test('X is inferred as A | B', () => {
        const x = getType(types, 'X') as UnionType;
        expect(x).toBeDefined();
        expectUnion(x, [
            {
                array: false,
                reference: false,
                types: ['A']
            },
            {
                array: false,
                reference: false,
                types: ['B']
            }
        ]);
    });

    test('C is inferred with super type Y and properties item:Y, value:ID', () => {
        const c = getType(types, 'C') as InterfaceType;
        expect(c).toBeDefined();
        expect(c.printingSuperTypes).toHaveLength(0);
        expect(c.properties).toHaveLength(2);
        expectProperty(c, 'value');
        expectProperty(c, {
            name: 'item',
            optional: false,
            typeAlternatives: [{
                array: false,
                reference: false,
                types: ['Y']
            }],
            astNodes: new Set(),
        });
    });

    test('Y is inferred from D with y:ID', () => {
        const y = getType(types, 'Y') as InterfaceType;
        expect(y).toBeDefined();
        expect(y.printingSuperTypes).toEqual(['C']);
        expect(y.properties).toHaveLength(1);
        expectProperty(y, 'y');
    });

    test('D is not inferred', () => {
        const d = getType(types, 'D');
        expect(d).toBeUndefined();
    });

});

describeTypes('inferred types that are used by the grammar', `
    A infers B: 'a' name=ID (otherA=[B])?;
    hidden terminal WS: /\\s+/;
    terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
    `, types => {

    test('B is defined and A is not', () => {
        const a = getType(types, 'A') as InterfaceType;
        expect(a).toBeUndefined();
        const b = getType(types, 'B') as InterfaceType;
        expect(b).toBeDefined();
    });
});

describe('expression rules with inferred and declared interfaces', () => {

    test('separate rules with assigned actions with inferred type and declared sub type of the former', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            interface Symbol {}
            interface SuperMemberAccess extends MemberAccess {}

            Expression:
                PrimaryExpression | MemberAccess | SuperMemberAccess
            ;

            PrimaryExpression:
                BooleanLiteral
            ;

            MemberAccess infers Expression:
                PrimaryExpression (
                    {infer MemberAccess.receiver=current} '.' member=[Symbol:'foo']
                )+
            ;

            SuperMemberAccess infers Expression:
                PrimaryExpression (
                    {SuperMemberAccess.receiver=current} '.' member=[Symbol:'super']
                )+
            ;

            BooleanLiteral:
                {infer BooleanLiteral} value?='true' | 'false'
            ;
        `);

        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);

        checkTypes(document.parseResult.value);
    });

    test('single rule with two assigned actions with inferred type and declared sub type of the former', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            interface Symbol {}
            interface SuperMemberAccess extends MemberAccess {}

            Expression:
                PrimaryExpression | MemberAccess
            ;

            PrimaryExpression:
                BooleanLiteral
            ;

            MemberAccess infers Expression:
                PrimaryExpression (
                    {SuperMemberAccess.receiver=current} '.' member=[Symbol:'super'] |
                    {infer MemberAccess.receiver=current} '.' member=[Symbol:'foo']
                )+
            ;

            BooleanLiteral:
                {infer BooleanLiteral} value?='true' | 'false'
            ;
        `);

        expect(document.parseResult.lexerErrors).toHaveLength(0);
        expect(document.parseResult.parserErrors).toHaveLength(0);

        checkTypes(document.parseResult.value);
    });

    // todo make tests like in this PR: https://github.com/langium/langium/pull/670
    // the PR #670 fixes the demonstrated bug, but cancels type inferrence for declared actions
    // we should fix the issue another way
    function checkTypes(grammar: Grammar) {
        const { parserRules, datatypeRules, interfaces, types } = collectAllAstResources([grammar]);

        // check only inferred types
        const inferred = collectInferredTypes(parserRules, datatypeRules);
        sortInterfacesTopologically(inferred.interfaces);
        specifyAstNodeProperties(inferred);

        const inferredInterfacesString = inferred.interfaces.map(toSubstring).join('\n').trim();
        expect(inferredInterfacesString).toBe(s`
            export interface BooleanLiteral extends AstNode {
                readonly $container: MemberAccess | SuperMemberAccess;
                value: boolean
            }
            export interface MemberAccess extends AstNode {
                readonly $container: MemberAccess | SuperMemberAccess;
                member: Reference<Symbol>
                receiver: PrimaryExpression
            }
            export interface SuperMemberAccess extends AstNode {
                readonly $container: MemberAccess | SuperMemberAccess;
                member: Reference<Symbol>
                receiver: PrimaryExpression
            }
        `);

        // check only declared types
        const declared = collectDeclaredTypes(interfaces, types);
        sortInterfacesTopologically(declared.interfaces);
        specifyAstNodeProperties(declared);

        expect(declared.interfaces.map(toSubstring).join('\n').trim()).toBe(s`
            export interface SuperMemberAccess extends MemberAccess {
            }
            export interface Symbol extends AstNode {
            }
        `);

        // check ast.ts types
        const allTypes = collectAst(undefined!, [grammar]);

        expect(allTypes.unions.map(toSubstring).join('\n').trim()).toBe(s`
            export type Expression = MemberAccess | PrimaryExpression | SuperMemberAccess;
            export type PrimaryExpression = BooleanLiteral;
        `);

        const allInterfacesString = allTypes.interfaces.map(toSubstring).join('\n').trim();
        expect(allInterfacesString).toBe(s`
            export interface BooleanLiteral extends AstNode {
                readonly $container: MemberAccess;
                value: boolean
            }
            export interface MemberAccess extends AstNode {
                readonly $container: MemberAccess;
                readonly $type: 'SuperMemberAccess';
                member: Reference<Symbol>
                receiver: PrimaryExpression
            }
            export interface SuperMemberAccess extends MemberAccess {
                readonly $container: MemberAccess;
            }
            export interface Symbol extends AstNode {
            }
        `);

        // the idea of the following is to double check that the declared definitions don't overwrite any
        // inferred definition; because of the sorting before joining the 'startsWith' doesn't work in general,
        // but it does work here due to the smart rule and interface name choice ;-)
        expect(allInterfacesString.startsWith(inferredInterfacesString));
    }
});

describe('types of `$container` and `$type` are correct', () => {

    // `$container`-types are appear only from inferred types
    test('types of `$container` and `$type` for declared types', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            interface A { strA: string }
            interface B { strB: string }
            interface C extends A, B { strC: string }
            interface D { a: A }
            interface E { b: B }
        `);
        const { unions, interfaces } = collectAst(undefined!, [document.parseResult.value]);

        const unionsString = unions.map(toSubstring).join('\n').trim();
        expect(unionsString).toBe(s``);

        const interfacesString = sortInterfacesTopologically(interfaces).map(toSubstring).join('\n').trim();
        expect(interfacesString).toBe(s`
            export interface A extends AstNode {
                readonly $container: D | E;
                readonly $type: 'C';
                strA: string
            }
            export interface B extends AstNode {
                readonly $container: D | E;
                readonly $type: 'C';
                strB: string
            }
            export interface D extends AstNode {
                a: A
            }
            export interface E extends AstNode {
                b: B
            }
            export interface C extends A, B {
                readonly $container: D | E;
                strC: string
            }
        `);
    });

    test('types of `$container` and `$type` for inferred types', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            terminal ID: /[_a-zA-Z][\\w_]*/;
            A: 'A' C;
            B: 'B' C;
            C: 'C' strC=ID;
            D: 'D' a=A;
            E: 'E' b=B;   
        `);
        const { unions, interfaces } = collectAst(undefined!, [document.parseResult.value]);

        const unionsString = unions.map(toSubstring).join('\n').trim();
        expect(unionsString).toBe(s`
            export type A = C;
            export type B = C;
        `);

        const interfacesString = sortInterfacesTopologically(interfaces).map(toSubstring).join('\n').trim();
        expect(interfacesString).toBe(s`
            export interface C extends AstNode {
                readonly $container: D | E;
                strC: string
            }
            export interface D extends AstNode {
                a: A
            }
            export interface E extends AstNode {
                b: B
            }
        `);
    });

    test('types of `$container` and `$type` for inferred and declared types', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            A: 'A' strA=ID;
            B: 'B' strB=ID;
            C returns C: 'C' strA=ID strB=ID strC=ID;
            interface C extends A, B { strC: string }
            D: 'D' a=A;
            E: 'E' b=B;
            terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
        `);
        const { unions, interfaces } = collectAst(undefined!, [document.parseResult.value]);

        const unionsString = unions.map(toSubstring).join('\n').trim();
        expect(unionsString).toBe(s``);

        const interfacesString = sortInterfacesTopologically(interfaces).map(toSubstring).join('\n').trim();
        expect(interfacesString).toBe(s`
            export interface A extends AstNode {
                readonly $container: D | E;
                readonly $type: 'C';
                strA: string
            }
            export interface B extends AstNode {
                readonly $container: D | E;
                readonly $type: 'C';
                strB: string
            }
            export interface D extends AstNode {
                a: A
            }
            export interface E extends AstNode {
                b: B
            }
            export interface C extends A, B {
                readonly $container: D | E;
                strC: string
            }
        `);

    });
});

// https://github.com/langium/langium/issues/744
describe('generated types from declared types include all of them', () => {

    test('using declared types has no impact on the generated types', async () => {
        const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
        const document = await parseHelper<Grammar>(grammarServices)(`
            A: 'A' a=ID;
            AB: A ({infer B} b+=ID)*;
            terminal ID: /[_a-zA-Z][\\w_]*/;
        `);
        const types = collectAst(undefined!, [document.parseResult.value]);

        const documentWithDeclaredTypes = await parseHelper<Grammar>(grammarServices)(`
            interface A { a: string; }
            interface B { b: string[]; }
            type AB = A | B;
            A returns A:  'A' a=ID;
            AB returns AB: A ({B} b+=ID)*;
            terminal ID: /[_a-zA-Z][\\w_]*/;        
        `);
        const typesWithDeclared = collectAst(undefined!, [documentWithDeclaredTypes.parseResult.value]);

        expect(typesWithDeclared.unions.map(toSubstring).join('\n').trim())
            .toBe(types.unions.map(toSubstring).join('\n').trim());

        expect(typesWithDeclared.interfaces.map(toSubstring).join('\n').trim())
            .toBe(types.interfaces.map(toSubstring).join('\n').trim());
    });

});

async function getTypes(grammar: string): Promise<AstTypes> {
    const services = createLangiumGrammarServices(EmptyFileSystem).grammar;
    const helper = parseHelper<Grammar>(services);
    const result = await helper(grammar);
    const gram = result.parseResult.value;
    const rules = gram.rules.filter(isParserRule);
    const datatypeRules = rules.filter(e => isDataTypeRule(e));
    const parserRules = rules.filter(e => !isDataTypeRule(e));
    return collectInferredTypes(parserRules, datatypeRules);
}

function getType(types: AstTypes, name: string): InterfaceType | UnionType | undefined {
    const interfaceType = types.interfaces.find(e => e.name === name);
    const unionType = types.unions.find(e => e.name === name);
    return interfaceType || unionType;
}

// general purpose property getter for interfaces, does not verify the property exists
function getProperty(interfaceType: InterfaceType, property: string): Property | undefined {
    return interfaceType.properties.find(e => e.name === property);
}

function expectProperty(interfaceType: InterfaceType, property: Property | string): void {
    if (typeof property === 'string') {
        const prop = getProperty(interfaceType, property)!;
        expect(prop).toBeDefined();
        expect(prop.optional).toStrictEqual(false);
    } else {
        const prop = getProperty(interfaceType, property.name)!;
        expect(prop).toBeDefined();
        expect(prop.optional).toStrictEqual(property.optional);
        expect(prop.typeAlternatives.length).toStrictEqual(property.typeAlternatives.length);
        for (let i = 0; i < prop.typeAlternatives.length; i++) {
            const actualType = prop.typeAlternatives[i];
            const expectedType = property.typeAlternatives[i];
            expect(actualType.types).toEqual(expectedType.types);
            expect(actualType.array).toEqual(expectedType.array);
            expect(actualType.reference).toEqual(expectedType.reference);
        }
    }
}

function expectUnion(unionType: UnionType, types: PropertyType[]): void {
    expect(unionType.alternatives.length).toStrictEqual(types.length);
    for (let i = 0; i < unionType.alternatives.length; i++) {
        const actualType = unionType.alternatives[i];
        const expectedType = types[i];
        expect(actualType.types).toEqual(expectedType.types);
        expect(actualType.array).toEqual(expectedType.array);
        expect(actualType.reference).toEqual(expectedType.reference);
    }
}

const toSubstring = (o: { toAstTypesString: () => string }) => {
    // this specialized 'toString' function uses the default 'toString' that is  producing the
    //  code generation output, and strips everything not belonging to the actual interface/type declaration
    const sRep = o.toAstTypesString().replace(/\r/g, '');
    return sRep.substring(
        0, 1 + (sRep.includes('interface') ? sRep.indexOf('}') : Math.min(sRep.indexOf(';') ))
    );
};
