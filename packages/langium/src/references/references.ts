/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { findAssignment } from '../grammar/grammar-util';
import { LangiumServices } from '../services';
import { AstNode, CstNode, Reference } from '../syntax-tree';
import { findNameNode, getDocument, isReference, streamAst, streamReferences } from '../utils/ast-util';
import { findRelevantNode, toDocumentSegment } from '../utils/cst-util';
import { stream, Stream } from '../utils/stream';
import { equalURI } from '../utils/uri-utils';
import { ReferenceDescription } from '../workspace/ast-descriptions';
import { AstNodeLocator } from '../workspace/ast-node-locator';
import { IndexManager } from '../workspace/index-manager';
import { NameProvider } from './naming';

/**
 * Language-specific service for finding references and declaration of a given `CstNode`.
 */
export interface References {

    /**
     * If the CstNode is a reference node the target CstNode will be returned.
     * If the CstNode is a significant node of the CstNode this CstNode will be returned.
     *
     * @param sourceCstNode CstNode that points to a AstNode
     */
    findDeclaration(sourceCstNode: CstNode): CstNode | undefined;
    /**
     * Finds all references to the target node as references (local references) or reference descriptions.
     *
     * @param targetNode Specified target node whose references should be returned
     */
    findReferences(targetNode: AstNode, options: FindReferencesOptions): Stream<ReferenceDescription>;
}

export interface FindReferencesOptions {
    onlyLocal?: boolean;
    includeDeclaration?: boolean;
}

export class DefaultReferences implements References {
    protected readonly nameProvider: NameProvider;
    protected readonly index: IndexManager;
    protected readonly nodeLocator: AstNodeLocator;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.index = services.shared.workspace.IndexManager;
        this.nodeLocator = services.workspace.AstNodeLocator;
    }

    findDeclaration(sourceCstNode: CstNode): CstNode | undefined {
        if (sourceCstNode) {
            const assignment = findAssignment(sourceCstNode);
            const nodeElem = findRelevantNode(sourceCstNode);
            if (assignment && nodeElem) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const reference = (nodeElem as any)[assignment.feature] as unknown;

                if (isReference(reference)) {
                    return this.processReference(reference);
                }
                else if (Array.isArray(reference)) {
                    for (const ref of reference) {
                        if (isReference(ref)) {
                            const target = this.processReference(ref);
                            if (target && target.text === sourceCstNode.text) return target;
                        }
                    }
                }
                else {
                    const nameNode = this.nameProvider.getNameNode(nodeElem);
                    if (nameNode === sourceCstNode
                        || nameNode && nameNode.offset <= sourceCstNode.offset
                        && nameNode.offset + nameNode.length > sourceCstNode.offset) {
                        return nameNode;
                    }
                }
            }
        }
        return undefined;
    }

    findReferences(targetNode: AstNode, options: FindReferencesOptions): Stream<ReferenceDescription> {
        if (options.onlyLocal) {
            return this.findLocalReferences(targetNode, options.includeDeclaration);
        } else {
            return this.findGlobalReferences(targetNode, options.includeDeclaration);
        }
    }

    protected findGlobalReferences(targetNode: AstNode, includeDeclaration = false): Stream<ReferenceDescription> {
        const refs: ReferenceDescription[] = [];
        if (includeDeclaration) {
            const ref = this.getReferenceToSelf(targetNode);
            if (ref) {
                refs.push(ref);
            }
        }
        refs.push(...this.index.findAllReferences(targetNode, this.nodeLocator.getAstNodePath(targetNode)));
        return stream(refs);
    }

    protected findLocalReferences(targetNode: AstNode, includeDeclaration = false): Stream<ReferenceDescription> {
        const doc = getDocument(targetNode);
        const rootNode = doc.parseResult.value;
        const refs: ReferenceDescription[] = [];
        if (includeDeclaration) {
            const ref = this.getReferenceToSelf(targetNode);
            if (ref) {
                refs.push(ref);
            }
        }
        const localReferences: Reference[] = [];
        streamAst(rootNode).forEach(node => {
            streamReferences(node).forEach(refInfo => {
                if (refInfo.reference.ref === targetNode) {
                    localReferences.push(refInfo.reference);
                }
            });
        });
        localReferences.forEach(ref => {
            refs.push({
                sourceUri: getDocument(ref.$refNode.element).uri,
                sourcePath: this.nodeLocator.getAstNodePath(ref.$refNode.element),
                targetUri: getDocument(targetNode).uri,
                targetPath: this.nodeLocator.getAstNodePath(targetNode),
                segment: toDocumentSegment(ref.$refNode),
                local: equalURI(getDocument(ref.$refNode.element).uri, getDocument(targetNode).uri)
            });
        });
        return stream(refs);
    }

    protected processReference(reference: Reference): CstNode | undefined {
        const ref = reference.ref;
        if (ref && ref.$cstNode) {
            const targetNode = this.nameProvider.getNameNode(ref);
            if (!targetNode) {
                return ref.$cstNode;
            }
            else {
                return targetNode;
            }
        }
        return undefined;
    }

    protected getReferenceToSelf(targetNode: AstNode): ReferenceDescription | undefined {
        const nameNode = findNameNode(targetNode, this.nameProvider);
        if (nameNode) {
            const doc = getDocument(targetNode);
            const path = this.nodeLocator.getAstNodePath(targetNode);
            return {
                sourceUri: doc.uri,
                sourcePath: path,
                targetUri: doc.uri,
                targetPath: path,
                segment: toDocumentSegment(nameNode),
                local: true
            };
        }
        return undefined;
    }
}