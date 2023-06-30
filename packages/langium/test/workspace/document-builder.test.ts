/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { LangiumServices } from '../../src/services';
import type { AstNode, Reference } from '../../src/syntax-tree';
import type { ValidationChecks } from '../../src/validation/validation-registry';
import type { LangiumDocument } from '../../src/workspace/documents';
import { describe, expect, test } from 'vitest';
import { CancellationTokenSource } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { createLangiumGrammarServices } from '../../src/grammar/langium-grammar-module';
import { createServicesForGrammar } from '../../src/utils/grammar-util';
import { isOperationCancelled } from '../../src/utils/promise-util';
import { DocumentState } from '../../src/workspace/documents';
import { EmptyFileSystem } from '../../src/workspace/file-system-provider';

describe('DefaultDocumentBuilder', () => {
    const grammarServices = createLangiumGrammarServices(EmptyFileSystem).grammar;
    async function createServices() {
        const grammar = `
            grammar Test
            entry Model:
                (foos+=Foo | bars+=Bar)*;
            Foo:
                'foo' value=INT bar=[Bar];
            Bar:
                'bar' name=ID;
            terminal INT returns number: /[0-9]+/;
            terminal ID: /[_a-zA-Z][\\w_]*/;
            hidden terminal WS: /\\s+/;
        `;
        const services = await createServicesForGrammar({ grammar, grammarServices });
        const checks: ValidationChecks<TestAstType> = {
            Foo: (node, accept) => {
                if (node.value > 10) {
                    accept('warning', 'Value is too large: ' + node.value, { node });
                }
            }
        };
        services.validation.ValidationRegistry.register(checks);
        return services;
    }

    test('resumes document build after cancellation', async () => {
        const services = await createServices();
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;
        const documents = services.shared.workspace.LangiumDocuments;
        const document1 = documentFactory.fromString(`
            foo 1 A
            foo 11 B
            bar A
            bar B
        `, URI.parse('file:///test1.txt'));
        documents.addDocument(document1);
        const document2 = documentFactory.fromString(`
            foo 1 C
            foo 11 D
            bar C
            bar D
        `, URI.parse('file:///test2.txt'));
        documents.addDocument(document2);

        const builder = services.shared.workspace.DocumentBuilder;
        const tokenSource1 = new CancellationTokenSource();
        builder.onBuildPhase(DocumentState.IndexedContent, () => {
            tokenSource1.cancel();
        });
        try {
            await builder.build([document1, document2], {}, tokenSource1.token);
        } catch (err) {
            expect(isOperationCancelled(err)).toBe(true);
        }
        expect(document1.state).toBe(DocumentState.IndexedContent);
        expect(document2.state).toBe(DocumentState.IndexedContent);

        addTextDocument(document1, services);
        await builder.update([document1.uri], []);
        // While the first document is built with validation due to its reported update, the second one
        // is resumed with its initial build options, which did not include validation.
        expect(document1.state).toBe(DocumentState.Validated);
        expect(document1.diagnostics?.map(d => d.message)).toEqual([
            'Value is too large: 11'
        ]);
        expect(document2.state).toBe(DocumentState.IndexedReferences);
        expect(document2.diagnostics).toBeUndefined();
    });

    test('includes document with references to updated document', async () => {
        const services = await createServices();
        const documentFactory = services.shared.workspace.LangiumDocumentFactory;
        const documents = services.shared.workspace.LangiumDocuments;
        const document1 = documentFactory.fromString(`
            foo 1 A
            foo 11 B
            bar A
            bar B
        `, URI.parse('file:///test1.txt'));
        documents.addDocument(document1);
        const document2 = documentFactory.fromString(`
            foo 1 C
            foo 11 A
            bar C
        `, URI.parse('file:///test2.txt'));
        documents.addDocument(document2);

        const builder = services.shared.workspace.DocumentBuilder;
        await builder.build([document1, document2], {});
        expect(document1.state).toBe(DocumentState.IndexedReferences);
        expect(document1.references.filter(r => r.error !== undefined)).toHaveLength(0);
        expect(document2.state).toBe(DocumentState.IndexedReferences);
        expect(document2.references.filter(r => r.error !== undefined)).toHaveLength(0);

        addTextDocument(document1, services);
        TextDocument.update(document1.textDocument, [{
            // Change `foo 1 A` to `foo 1 D`, breaking the local reference
            range: { start: { line: 1, character: 18 }, end: { line: 1, character: 19 } },
            text: 'D'
        }], 1);
        addTextDocument(document2, services);
        builder.updateBuildOptions = {
            validation: {
                // Only the linking error is reported for the first document
                stopAfterLinkingErrors: true
            }
        };
        await builder.update([document1.uri], []);
        expect(document1.state).toBe(DocumentState.Validated);
        expect(document1.diagnostics?.map(d => d.message)).toEqual([
            'Could not resolve reference to Bar named \'D\'.'
        ]);
        expect(document2.state).toBe(DocumentState.Validated);
        expect(document2.diagnostics?.map(d => d.message)).toEqual([
            'Value is too large: 11'
        ]);
    });

});

/**
 * Add the given document to the TextDocuments service, simulating it being opened in an editor.
 */
function addTextDocument(doc: LangiumDocument, services: LangiumServices) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textDocuments = services.shared.workspace.TextDocuments as any;
    textDocuments._syncedDocuments.set(doc.uri.toString(), doc.textDocument);
}

type TestAstType = {
    Model: Model
    Foo: Foo
    Bar: Bar
}

interface Model extends AstNode {
    foos: Foo[]
}

interface Foo extends AstNode {
    value: number
    bar: Reference<Bar>
}

interface Bar extends AstNode {
    name: string
}
