/******************************************************************************
 * Copyright 2022 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { Grammar } from '../generated/ast';
import { LangiumDocuments } from '../../workspace/documents';
import { collectTypeHierarchy, sortInterfacesTopologically } from './types-util';
import { AstTypes, isArrayType, isInterfaceType, isPrimitiveType, isPropertyUnion, isStringType, isUnionType, isValueType, PropertyType, TypeOption, UnionType } from './type-collector/types';
import { collectTypeResources, ValidationAstTypes } from './type-collector/all-types';
import { PlainAstTypes, PlainInterface, plainToTypes, PlainUnion } from './type-collector/plain-types';

/**
 * Collects all types for the generated AST. The types collector entry point.
 *
 * @param grammars All grammars involved in the type generation process
 * @param documents Additional documents so that imports can be resolved as necessary
 */
export function collectAst(grammars: Grammar | Grammar[], documents?: LangiumDocuments): AstTypes {
    const { inferred, declared } = collectTypeResources(grammars, documents);
    return createAstTypes(inferred, declared);
}

/**
 * Collects all types used during the validation process.
 * The validation process requires us to compare our inferred types with our declared types.
 *
 * @param grammars All grammars involved in the validation process
 * @param documents Additional documents so that imports can be resolved as necessary
 */
export function collectValidationAst(grammars: Grammar | Grammar[], documents?: LangiumDocuments): ValidationAstTypes {
    const { inferred, declared, astResources } = collectTypeResources(grammars, documents);

    return {
        astResources,
        inferred: createAstTypes(declared, inferred),
        declared: createAstTypes(inferred, declared)
    };
}

export function createAstTypes(first: PlainAstTypes, second?: PlainAstTypes): AstTypes {
    const astTypes: PlainAstTypes = {
        interfaces: sortInterfacesTopologically(mergeAndRemoveDuplicates<PlainInterface>(...first.interfaces, ...second?.interfaces ?? [])),
        unions: mergeAndRemoveDuplicates<PlainUnion>(...first.unions, ...second?.unions ?? []),
    };

    const finalTypes = plainToTypes(astTypes);
    specifyAstNodeProperties(finalTypes);
    return finalTypes;
}

/**
 * Merges the lists of given elements into a single list and removes duplicates. Elements later in the lists get precedence over earlier elements.
 *
 * The distinction is performed over the `name` property of the element. The result is a name-sorted list of elements.
 */
function mergeAndRemoveDuplicates<T extends { name: string }>(...elements: T[]): T[] {
    return Array.from(elements
        .reduce((acc, type) => { acc.set(type.name, type); return acc; }, new Map<string, T>())
        .values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function specifyAstNodeProperties(astTypes: AstTypes) {
    const nameToType = filterInterfaceLikeTypes(astTypes);
    const array = Array.from(nameToType.values());
    flattenHierarchy(array);
    buildContainerTypes(array);
    buildTypeNames(nameToType);
}

function buildTypeNames(nameToType: Map<string, TypeOption>) {
    const queue = Array.from(nameToType.values()).filter(e => e.subTypes.size === 0);
    const visited = new Set<TypeOption>();
    for (const type of queue) {
        visited.add(type);
        type.typeNames.add(type.name);
        const superTypes = Array.from(type.superTypes)
            .map(superType => nameToType.get(superType.name))
            .filter(e => e !== undefined) as TypeOption[];
        for (const superType of superTypes) {
            type.typeNames.forEach(e => superType.typeNames.add(e));
        }
        queue.push(...superTypes.filter(e => !visited.has(e)));
    }
}

/**
 * Removes union types that reference only to primitive types or
 * types that reference only to primitive types.
 */
function filterInterfaceLikeTypes({ interfaces, unions }: AstTypes): Map<string, TypeOption> {
    const nameToType = (interfaces as TypeOption[]).concat(unions)
        .reduce((acc, e) => { acc.set(e.name, e); return acc; }, new Map<string, TypeOption>());

    const cache = new Map<UnionType, boolean>();

    for (const union of unions) {
        cache.set(union, isDataType(union.type, new Set()));
    }
    for (const [union, isDataType] of cache) {
        if (isDataType) {
            nameToType.delete(union.name);
        }
    }
    return nameToType;
}

function isDataType(property: PropertyType, visited: Set<PropertyType>): boolean {
    if (visited.has(property)) {
        return true;
    }
    visited.add(property);
    if (isPropertyUnion(property)) {
        return property.types.every(e => isDataType(e, visited));
    } else if (isValueType(property)) {
        const value = property.value;
        if (isUnionType(value)) {
            return isDataType(value.type, visited);
        } else {
            return false;
        }
    } else {
        return isPrimitiveType(property) || isStringType(property);
    }
}

function flattenHierarchy(types: TypeOption[]) {
    // Recursively collect all supertypes
    const visited = new Set<TypeOption>();
    const collect = (type: TypeOption): void => {
        if (visited.has(type)) return;
        visited.add(type);
        for (const superType of type.superTypes) {
            collect(superType);
            superType.superTypes.forEach(t => type.superTypes.add(t));
            type.superTypes.add(superType);
        }
    };
    types.forEach(collect);

    // Invert all supertypes
    for (const type of types) {
        type.superTypes.forEach(t => t.subTypes.add(type));
    }
}

/**
 * Builds container types for given interfaces.
 * @param interfaces The interfaces that have to get container types.
 */
function buildContainerTypes(types: TypeOption[]) {
    // 1st stage: collect container types
    const interfaces = types.filter(isInterfaceType);
    for (const interfaceType of interfaces) {
        const refTypes = interfaceType.properties.flatMap(property => findChildTypes(property.type, new Set()));
        for (const refType of refTypes) {
            refType.containerTypes.add(interfaceType);
        }
    }

    // 2nd stage: share container types
    const connectedComponents = calculateConnectedComponents(types);
    shareContainerTypes(connectedComponents);
}

function findChildTypes(type: PropertyType, set: Set<TypeOption>): TypeOption[] {
    if (isPropertyUnion(type)) {
        return type.types.flatMap(e => findChildTypes(e, set));
    } else if (isValueType(type)) {
        if (set.has(type.value)) {
            return [];
        } else {
            set.add(type.value);
        }
        return [type.value];
    } else if (isArrayType(type)) {
        return findChildTypes(type.elementType, set);
    } else {
        return [];
    }
}

function calculateConnectedComponents(interfaces: TypeOption[]): TypeOption[][] {
    function dfs(typeInterface: TypeOption): TypeOption[] {
        const component: TypeOption[] = [typeInterface];
        visited.add(typeInterface);
        const allTypes = [
            ...hierarchy.subTypes.get(typeInterface.name),
            ...hierarchy.superTypes.get(typeInterface.name)
        ];
        for (const nextTypeInterface of allTypes) {
            const nextType = map.get(nextTypeInterface);
            if (nextType && !visited.has(nextType)) {
                component.push(...dfs(nextType));
            }
        }
        return component;
    }

    const map = new Map(interfaces.map(e => [e.name, e]));
    const connectedComponents: TypeOption[][] = [];
    const hierarchy = collectTypeHierarchy(interfaces);
    const visited = new Set<TypeOption>();
    for (const typeInterface of interfaces) {
        if (!visited.has(typeInterface)) {
            connectedComponents.push(dfs(typeInterface));
        }
    }
    return connectedComponents;
}

function shareContainerTypes(connectedComponents: TypeOption[][]): void {
    for (const component of connectedComponents) {
        const superSet = new Set<TypeOption>();
        component.forEach(type => type.containerTypes.forEach(e => superSet.add(e)));
        component.forEach(type => type.containerTypes = superSet);
    }
}
