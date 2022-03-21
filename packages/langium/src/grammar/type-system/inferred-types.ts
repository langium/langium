/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { getRuleType, getTypeName, isOptional } from '../grammar-util';
import { AbstractElement, Action, Alternatives, Assignment, Group, isAction, isAlternatives, isAssignment, isCrossReference, isGroup, isKeyword, isParserRule, isRuleCall, isUnorderedGroup, ParserRule, RuleCall, UnorderedGroup } from '../generated/ast';
import { stream } from '../../utils/stream';
import { AstTypes, distictAndSorted, Property, PropertyType, InterfaceType, UnionType } from './types-util';
import { MultiMap } from '../../utils/collections';

interface TypePart {
    name?: string
    properties: Property[]
    ruleCalls: string[]
    parents: TypePart[]
    children: TypePart[]
    actionWithAssignment: boolean
}

type TypeAlternative = {
    name: string
    super: string[]
    properties: Property[]
    ruleCalls: string[]
}

type TypeCollection = {
    types: Set<string>,
    reference: boolean
}

function copy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function collectSuperTypes(original: TypePart, part: TypePart, set: Set<string>): void {
    if (part.ruleCalls.length > 0) {
        // Each unassigned rule call corresponds to a super type
        for (const ruleCall of part.ruleCalls) {
            set.add(ruleCall);
        }
        return;
    }
    for (const parent of part.parents) {
        if (original.name === undefined) {
            collectSuperTypes(parent, parent, set);
        } else if (parent.name !== undefined && parent.name !== original.name) {
            set.add(parent.name);
        } else {
            collectSuperTypes(original, parent, set);
        }
    }
    if (part.parents.length === 0 && part.name) {
        set.add(part.name);
    }
}

interface TypeCollectionContext {
    fragments: Map<ParserRule, Property[]>
}

interface TypePath {
    alt: TypeAlternative
    next: TypePart[]
}

class TypeGraph {
    context: TypeCollectionContext;
    root: TypePart;

    constructor(context: TypeCollectionContext, root: TypePart) {
        this.context = context;
        this.root = root;
    }

    getTypes(): TypeAlternative[] {
        const rootType: TypeAlternative = {
            name: this.root.name!,
            properties: this.root.properties,
            ruleCalls: this.root.ruleCalls,
            super: []
        };
        if (this.root.children.length === 0) {
            return [rootType];
        } else {
            return this.applyNext(this.root, {
                alt: rootType,
                next: this.root.children
            }).map(e => e.alt);
        }
    }

    private applyNext(root: TypePart, nextPath: TypePath): TypePath[] {
        const splits = this.splitType(nextPath.alt, nextPath.next.length);
        const paths: TypePath[] = [];
        for (let i = 0; i < nextPath.next.length; i++) {
            const split = splits[i];
            const part = nextPath.next[i];
            if (part.actionWithAssignment) {
                // If the path enters an action with an assignment which changes the current name
                // We already add a new path, since the next part of the part refers to a new inferred type
                paths.push({
                    alt: copy(split),
                    next: []
                });
            }
            if (part.name !== undefined && part.name !== split.name) {
                if (part.actionWithAssignment) {
                    // We reset all properties, super types and ruleCalls since we are now in a new inferred type
                    split.properties = [];
                    split.ruleCalls = [];
                    split.super = [root.name!];
                    split.name = part.name;
                } else {
                    split.super = [split.name];
                    split.name = part.name;
                }
            }
            split.properties.push(...part.properties);
            split.ruleCalls.push(...part.ruleCalls);
            const path: TypePath = {
                alt: split,
                next: part.children
            };
            if (path.next.length === 0) {
                path.alt.super = path.alt.super.filter(e => e !== path.alt.name);
                paths.push(path);
            } else {
                paths.push(...this.applyNext(root, path));
            }
        }
        return paths;
    }

    private splitType(type: TypeAlternative, count: number): TypeAlternative[] {
        const alternatives: TypeAlternative[] = [];
        for (let i = 0; i < count; i++) {
            alternatives.push(copy(type));
        }
        return alternatives;
    }

    getSuperTypes(node: TypePart): string[] {
        const set = new Set<string>();
        collectSuperTypes(node, node, set);
        return Array.from(set).sort();
    }

    connect(parent: TypePart, children: TypePart): TypePart {
        children.parents.push(parent);
        parent.children.push(children);
        return children;
    }

    merge(...parts: TypePart[]): TypePart | undefined {
        if (parts.length === 1) {
            return parts[0];
        } else if (parts.length === 0) {
            return undefined;
        }
        const node = newTypePart();
        node.parents = parts;
        for (const parent of parts) {
            parent.children.push(node);
        }
        return node;
    }
}

export function collectInferredTypes(parserRules: ParserRule[], datatypeRules: ParserRule[]): AstTypes {
    // extract interfaces and types from parser rules
    const allTypes: TypeAlternative[] = [];
    const context: TypeCollectionContext = {
        fragments: new Map()
    };
    for (const rule of parserRules) {
        allTypes.push(...getRuleTypes(context, rule));
    }
    const interfaces = calculateAst(allTypes);
    buildContainerTypes(interfaces);
    const inferredTypes = extractTypes(interfaces);

    const allSupertypes = new MultiMap<string, string>();
    for (const interfaceType of interfaces.values()) {
        for (const superType of interfaceType.superTypes) {
            allSupertypes.add(superType, interfaceType.name);
        }
    }
    for (const superType of allSupertypes.keys()) {
        if (!interfaces.some(e => e.name === superType)) {
            inferredTypes.unions.push({
                name: superType,
                reflection: true,
                superTypes: [],
                union: [{
                    array: false,
                    reference: false,
                    types: [...allSupertypes.get(superType)]
                }]
            });
        }
    }

    // extract types from datatype rules
    for (const rule of datatypeRules) {
        const types = isAlternatives(rule.alternatives) && rule.alternatives.elements.every(e => isKeyword(e)) ?
            stream(rule.alternatives.elements).filter(isKeyword).map(e => `'${e.value}'`).toArray().sort() :
            [rule.type?.name ?? 'string'];
        inferredTypes.unions.push(new UnionType(rule.name, [<PropertyType>{ types, reference: false, array: false }]));
    }
    return inferredTypes;
}

function getRuleTypes(context: TypeCollectionContext, rule: ParserRule): TypeAlternative[] {
    const type = newTypePart(rule);
    const graph = new TypeGraph(context, type);
    collectElement(graph, graph.root, rule.alternatives);
    return graph.getTypes();
}

function newTypePart(rule?: ParserRule | string): TypePart {
    return {
        name: isParserRule(rule) ? getTypeName(rule) : rule,
        properties: [],
        ruleCalls: [],
        children: [],
        parents: [],
        actionWithAssignment: false
    };
}

/**
 * Collects all possible type branches of a given element.
 * @param state State to walk over element's graph.
 * @param type Element that collects a current type branch for the given element.
 * @param element The given AST element, from which it's necessary to extract the type.
 */
function collectElement(graph: TypeGraph, current: TypePart, element: AbstractElement): TypePart {
    const optional = isOptional(element.cardinality);
    if (isAlternatives(element)) {
        const children: TypePart[] = [];
        if (optional) {
            children.push(current);
        }
        for (const alt of element.elements) {
            const altType = graph.connect(current, newTypePart());
            children.push(collectElement(graph, altType, alt));
        }
        return graph.merge(...children)!;
    } else if (isGroup(element) || isUnorderedGroup(element)) {
        let groupNode = optional ? graph.connect(current, newTypePart()) : current;
        for (const item of element.elements) {
            groupNode = collectElement(graph, groupNode, item);
        }
        if (optional) {
            return graph.merge(current, groupNode)!;
        } else {
            return groupNode;
        }
    } else if (isAction(element)) {
        return addAction(graph, current, element);
    } else if (isAssignment(element)) {
        addAssignment(current, element);
    } else if (isRuleCall(element)) {
        addRuleCall(graph, current, element);
    }
    return current;
}

function addAction(graph: TypeGraph, parent: TypePart, action: Action): TypePart {
    const typeNode = graph.connect(parent, newTypePart(action.type));

    if (action.feature && action.operator) {
        typeNode.actionWithAssignment = true;
        typeNode.properties.push({
            name: action.feature,
            optional: false,
            typeAlternatives: [{
                array: action.operator === '+=',
                reference: false,
                types: graph.getSuperTypes(typeNode)
            }]
        });
    }
    return typeNode;
}

function addAssignment(current: TypePart, assignment: Assignment): void {
    const typeItems: TypeCollection = { types: new Set(), reference: false };
    findTypes(assignment.terminal, typeItems);
    current.properties.push({
        name: assignment.feature,
        optional: isOptional(assignment.cardinality),
        typeAlternatives: [{
            array: assignment.operator === '+=',
            types: assignment.operator === '?=' ? ['boolean'] : Array.from(typeItems.types).sort(),
            reference: typeItems.reference
        }]
    });
}

function findTypes(terminal: AbstractElement, types: TypeCollection): void {
    if (isAlternatives(terminal) || isUnorderedGroup(terminal) || isGroup(terminal)) {
        findInCollection(terminal, types);
    } else if (isKeyword(terminal)) {
        types.types.add(`'${terminal.value}'`);
    } else if (isRuleCall(terminal) && terminal.rule.ref) {
        types.types.add(getRuleType(terminal.rule.ref));
    } else if (isCrossReference(terminal) && terminal.type.ref) {
        types.types.add(getTypeName(terminal.type.ref));
        types.reference = true;
    }
}

function findInCollection(collection: Alternatives | Group | UnorderedGroup, types: TypeCollection): void {
    for (const element of collection.elements) {
        findTypes(element, types);
    }
}

function addRuleCall(graph: TypeGraph, current: TypePart, ruleCall: RuleCall): void {
    const rule = ruleCall.rule.ref;
    // Add all properties of fragments to the current type
    if (isParserRule(rule) && rule.fragment) {
        const properties = getFragmentProperties(rule, graph.context);
        if (isOptional(ruleCall.cardinality)) {
            current.properties.push(...properties.map(e => ({
                ...e,
                optional: true
            })));
        } else {
            current.properties.push(...properties);
        }
    } else if (isParserRule(rule)) {
        current.ruleCalls.push(getRuleType(rule));
    }
}

function getFragmentProperties(fragment: ParserRule, context: TypeCollectionContext): Property[] {
    const existing = context.fragments.get(fragment);
    if (existing) {
        return existing;
    }
    const properties: Property[] = [];
    context.fragments.set(fragment, properties);
    const fragmentName = getTypeName(fragment);
    const typeAlternatives = getRuleTypes(context, fragment);
    const types = calculateAst(typeAlternatives);
    const foundType = types.find(e => e.name === fragmentName);
    if (foundType) {
        properties.push(...foundType.properties);
    }
    return properties;
}

/**
 * Calculate interfaces from all possible type branches.
 * [some of these interfaces will become types in the generated AST]
 * @param alternatives The type branches that will be squashed in interfaces.
 * @returns Interfaces.
 */
function calculateAst(alternatives: TypeAlternative[]): InterfaceType[] {
    const interfaces = new Map<string, InterfaceType>();
    const ruleCallAlternatives: TypeAlternative[] = [];
    const flattened = flattenTypes(alternatives);

    for (const flat of flattened) {
        const interfaceType = new InterfaceType(flat.name, flat.super, flat.properties);
        interfaces.set(interfaceType.name, interfaceType);
        if (flat.ruleCalls.length > 0) {
            ruleCallAlternatives.push(flat);
        }
        // all other cases assume we have a data type rule
        // we do not generate an AST type for data type rules
    }

    for (const ruleCallType of ruleCallAlternatives) {
        let exists = false;
        for (const ruleCall of ruleCallType.ruleCalls) {
            const calledInterface = interfaces.get(ruleCall);
            if (calledInterface) {
                if (calledInterface.name === ruleCallType.name) {
                    exists = true;
                } else {
                    calledInterface.superTypes.push(ruleCallType.name);
                }
            }
        }
        if (!exists && !interfaces.has(ruleCallType.name)) {
            interfaces.set(ruleCallType.name, new InterfaceType(ruleCallType.name, ruleCallType.super, []));
        }
    }
    for (const interfaceType of interfaces.values()) {
        interfaceType.superTypes = Array.from(new Set(interfaceType.superTypes));
    }
    return Array.from(interfaces.values());
}

function flattenTypes(alternatives: TypeAlternative[]): TypeAlternative[] {
    const names = new Set<string>(alternatives.map(e => e.name));
    const types: TypeAlternative[] = [];

    for (const name of names) {
        const properties: Property[] = [];
        const ruleCalls = new Set<string>();
        const type: TypeAlternative = { name, properties, ruleCalls: [], super: [] };
        const namedAlternatives = alternatives.filter(e => e.name === name);
        for (const alt of namedAlternatives) {
            type.super.push(...alt.super);
            const altProperties = alt.properties;
            const foundProperties = new Set<string>();
            for (const altProperty of altProperties) {
                foundProperties.add(altProperty.name);
                const existingProperty = properties.find(e => e.name === altProperty.name);
                if (existingProperty) {
                    altProperty.typeAlternatives.filter(isNotInTypeAlternatives(existingProperty.typeAlternatives)).forEach(type => existingProperty.typeAlternatives.push(type));
                } else {
                    properties.push({ ...altProperty });
                }
            }
            if (altProperties.length === 0) {
                alt.ruleCalls.forEach(ruleCall => ruleCalls.add(ruleCall));
            }
        }
        for (const alt of namedAlternatives) {
            // A type with rule calls is not a real member of the type
            // Any missing properties are therefore not associated with the current type
            if (alt.ruleCalls.length === 0) {
                for (const property of properties) {
                    if (!alt.properties.find(e => e.name === property.name)) {
                        property.optional = true;
                    }
                }
            }
        }
        type.ruleCalls = Array.from(ruleCalls);
        types.push(type);
    }

    return types;
}

function isNotInTypeAlternatives(typeAlternatives: PropertyType[]): (type: PropertyType) => boolean {
    return (type: PropertyType) => {
        return !typeAlternatives.some(e => comparePropertyType(e, type));
    };
}

function comparePropertyType(a: PropertyType, b: PropertyType): boolean {
    return a.array === b.array &&
        a.reference === b.reference &&
        compareLists(a.types, b.types);
}

function compareLists<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean = (x: T, y: T) => x === y): boolean {
    if (a.length !== b.length) return false;
    const distictAndSortedA = distictAndSorted(a);
    return distictAndSorted(b).every((e, i) => eq(e, distictAndSortedA[i]));
}

/**
 * Builds container types for given interfaces.
 * @param interfaces The interfaces that have to get container types.
 */
function buildContainerTypes(interfaces: InterfaceType[]): void {
    // 1st stage: collect container types & calculate sub-types
    for (const interfaceType of interfaces) {
        for (const typeName of interfaceType.properties.flatMap(property => property.typeAlternatives.filter(e => !e.reference).flatMap(e => e.types))) {
            interfaces.find(e => e.name === typeName)
                ?.containerTypes.push(interfaceType.name);
        }
        for (const superTypeName of interfaceType.superTypes) {
            interfaces.find(e => e.name === superTypeName)
                ?.subTypes.push(interfaceType.name);
        }
    }
    // 2nd stage: share container types
    const connectedComponents: InterfaceType[][] = [];
    calculateConnectedComponents(connectedComponents, interfaces);
    shareContainerTypes(connectedComponents);
}

function calculateConnectedComponents(connectedComponents: InterfaceType[][], interfaces: InterfaceType[]): void {
    function dfs(typeInterface: InterfaceType): InterfaceType[] {
        const component: InterfaceType[] = [typeInterface];
        visited.add(typeInterface.name);
        for (const nextTypeInterfaceName of typeInterface.subTypes.concat(typeInterface.superTypes)) {
            if (!visited.has(nextTypeInterfaceName)) {
                const nextTypeInterface = interfaces.find(e => e.name === nextTypeInterfaceName);
                if (nextTypeInterface) {
                    component.push(...dfs(nextTypeInterface));
                }
            }
        }
        return component;
    }

    const visited: Set<string> = new Set();
    for (const typeInterface of interfaces) {
        if (!visited.has(typeInterface.name)) {
            connectedComponents.push(dfs(typeInterface));
        }
    }
}

function shareContainerTypes(connectedComponents: InterfaceType[][]): void {
    for (const component of connectedComponents) {
        const containerTypes: string[] = [];
        component.forEach(type => containerTypes.push(...type.containerTypes));
        component.forEach(type => type.containerTypes = containerTypes);
    }
}

/**
 * Filters interfaces, transforming some of them in types.
 * The transformation criterion: no properties, but have subtypes.
 * @param interfaces The interfaces that have to be transformed on demand.
 * @returns Types and not transformed interfaces.
 */
function extractTypes(interfaces: InterfaceType[]): AstTypes {
    const astTypes: AstTypes = { interfaces: [], unions: [] };
    const typeNames: string[] = [];
    for (const interfaceType of interfaces) {
        // the criterion for converting an interface into a type
        if (interfaceType.properties.length === 0 && interfaceType.subTypes.length > 0) {
            const alternative: PropertyType = {
                types: [...interfaceType.subTypes].sort(),
                reference: false,
                array: false
            };
            const type = new UnionType(interfaceType.name, [alternative], { reflection: true });
            type.superTypes = interfaceType.superTypes;
            astTypes.unions.push(type);
            typeNames.push(interfaceType.name);
        } else {
            astTypes.interfaces.push(interfaceType);
        }
    }
    // define printingSuperTypes containing intefaces that
    // became types from super types of their "former" children
    for (const interfaceType of astTypes.interfaces) {
        interfaceType.printingSuperTypes = interfaceType.superTypes.filter(superType => !typeNames.includes(superType)).sort();
    }
    return astTypes;
}
