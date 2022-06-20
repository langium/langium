/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { CancellationToken, Location, Range, ReferenceParams } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { NameProvider } from '../references/naming';
import { References } from '../references/references';
import { LangiumServices } from '../services';
import { AstNode, CstNode, LeafCstNode } from '../syntax-tree';
import { getDocument, isReference } from '../utils/ast-util';
import { findLeafNodeAtOffset, flattenCst } from '../utils/cst-util';
import { MaybePromise } from '../utils/promise-util';
import { LangiumDocument } from '../workspace/documents';

/**
 * Language-specific service for handling find references requests.
 */
export interface ReferenceFinder {
    /**
     * Handle a find references request.
     *
     * @throws `OperationCancelled` if cancellation is detected during execution
     * @throws `ResponseError` if an error is detected that should be sent as response to the client
     */
    findReferences(document: LangiumDocument, params: ReferenceParams, cancelToken?: CancellationToken): MaybePromise<Location[]>;
}

export interface ReferenceLocation {
    docUri: URI
    range: Range
}

export class DefaultReferenceFinder implements ReferenceFinder {
    protected readonly nameProvider: NameProvider;
    protected readonly references: References;

    constructor(services: LangiumServices) {
        this.nameProvider = services.references.NameProvider;
        this.references = services.references.References;
    }

    findReferences(document: LangiumDocument, params: ReferenceParams): MaybePromise<Location[]> {
        const rootNode = document.parseResult.value.$cstNode;
        if (!rootNode) {
            return [];
        }

        const selectedNode = findLeafNodeAtOffset(rootNode, document.textDocument.offsetAt(params.position));
        if (!selectedNode) {
            return [];
        }

        const refs: ReferenceLocation[] = this.getReferences(selectedNode, params, document);

        return refs.map(ref => Location.create(
            ref.docUri.toString(),
            ref.range
        ));
    }

    protected getReferences(selectedNode: LeafCstNode, params: ReferenceParams, document: LangiumDocument<AstNode>): ReferenceLocation[] {
        const refs: ReferenceLocation[] = [];
        const targetAstNode = this.references.findDeclaration(selectedNode)?.element;
        if (targetAstNode) {
            if (params.context.includeDeclaration) {
                const declDoc = getDocument(targetAstNode);
                const nameNode = this.findNameNode(targetAstNode, selectedNode.text);
                if (nameNode)
                    refs.push({ docUri: declDoc.uri, range: nameNode.range });
            }
            this.references.findReferences(targetAstNode).forEach(reference => {
                if (isReference(reference)) {
                    refs.push({ docUri: document.uri, range: reference.$refNode.range });
                } else {
                    const range = reference.segment.range;
                    refs.push({ docUri: reference.sourceUri, range: range });
                }
            });
        }
        return refs;
    }

    protected findNameNode(node: AstNode, name: string): CstNode | undefined {
        const nameNode = this.nameProvider.getNameNode(node);
        if (nameNode)
            return nameNode;
        if (node.$cstNode) {
            // try find first leaf with name as text
            const leafNode = flattenCst(node.$cstNode).find((n) => n.text === name);
            if (leafNode)
                return leafNode;
        }
        return node.$cstNode;
    }
}
