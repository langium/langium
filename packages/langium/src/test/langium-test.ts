/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import {
    CompletionItem, Diagnostic, DiagnosticSeverity, DocumentSymbol, MarkupContent, Range, TextDocumentIdentifier, TextDocumentPositionParams
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { LangiumServices } from '../services';
import { AstNode } from '../syntax-tree';
import { escapeRegExp } from '../utils/regex-util';
import { LangiumDocument } from '../workspace/documents';

export function parseHelper<T extends AstNode = AstNode>(services: LangiumServices): (input: string) => Promise<LangiumDocument<T>> {
    const metaData = services.LanguageMetaData;
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    return async input => {
        const randomNumber = Math.floor(Math.random() * 10000000) + 1000000;
        const uri = URI.parse(`file:///${randomNumber}${metaData.fileExtensions[0]}`);
        const document = services.shared.workspace.LangiumDocumentFactory.fromString<T>(input, uri);
        await documentBuilder.build([document]);
        return document;
    };
}

export type ExpectFunction = (actual: unknown, expected: unknown) => void;

export interface ExpectedBase {
    text: string
    indexMarker?: string
    rangeStartMarker?: string
    rangeEndMarker?: string
}

export interface ExpectedSymbols extends ExpectedBase {
    expectedSymbols: DocumentSymbol[]
}

export function expectSymbols(services: LangiumServices, expectEqual: ExpectFunction): (input: ExpectedSymbols) => Promise<void> {
    return async input => {
        const document = await parseDocument(services, input.text);
        const symbolProvider = services.lsp.DocumentSymbolProvider;
        const symbols = await symbolProvider.getSymbols(document, textDocumentParams(document));
        expectEqual(symbols.length, input.expectedSymbols.length);
        for (let i = 0; i < input.expectedSymbols.length; i++) {
            const expected = input.expectedSymbols[i];
            const item = symbols[i];
            if (typeof expected === 'string') {
                expectEqual(item.name, expected);
            } else {
                expectEqual(item, expected);
            }
        }
    };
}

export function expectFoldings(services: LangiumServices, expectEqual: ExpectFunction): (input: ExpectedBase) => Promise<void> {
    return async input => {
        const { output, ranges } = replaceIndices(input);
        const document = await parseDocument(services, output);
        const foldingRangeProvider = services.lsp.FoldingRangeProvider;
        const foldings = await foldingRangeProvider.getFoldingRanges(document, textDocumentParams(document));
        foldings.sort((a, b) => a.startLine - b.startLine);
        expectEqual(foldings.length, ranges.length);
        for (let i = 0; i < ranges.length; i++) {
            const expected = ranges[i];
            const item = foldings[i];
            expectEqual(item.startLine, document.textDocument.positionAt(expected[0]).line);
            expectEqual(item.endLine, document.textDocument.positionAt(expected[1]).line);
        }
    };
}

function textDocumentParams(document: LangiumDocument): { textDocument: TextDocumentIdentifier } {
    return { textDocument: { uri: document.textDocument.uri } };
}

export interface ExpectedCompletion extends ExpectedBase {
    index: number
    expectedItems: Array<string | CompletionItem>
}

export function expectCompletion(services: LangiumServices, expectEqual: ExpectFunction): (completion: ExpectedCompletion) => Promise<void> {
    return async expectedCompletion => {
        const { output, indices } = replaceIndices(expectedCompletion);
        const document = await parseDocument(services, output);
        const completionProvider = services.lsp.completion.CompletionProvider;
        const offset = indices[expectedCompletion.index];
        const completions = await completionProvider.getCompletion(document, textDocumentPositionParams(document, offset));
        const items = completions.items.sort((a, b) => a.sortText?.localeCompare(b.sortText || '0') || 0);
        expectEqual(items.length, expectedCompletion.expectedItems.length);
        for (let i = 0; i < expectedCompletion.expectedItems.length; i++) {
            const expected = expectedCompletion.expectedItems[i];
            const completion = items[i];
            if (typeof expected === 'string') {
                expectEqual(completion.label, expected);
            } else {
                expectEqual(completion, expected);
            }
        }
    };
}

export interface ExpectedGoToDefinition extends ExpectedBase {
    index: number,
    rangeIndex: number
}

export function expectGoToDefinition(services: LangiumServices, expectEqual: ExpectFunction): (expectedGoToDefinition: ExpectedGoToDefinition) => Promise<void> {
    return async expectedGoToDefinition => {
        const { output, indices, ranges } = replaceIndices(expectedGoToDefinition);
        const document = await parseDocument(services, output);
        const goToResolver = services.lsp.GoToResolver;
        const locationLink = await goToResolver.goToDefinition(document, textDocumentPositionParams(document, indices[expectedGoToDefinition.index])) ?? [];
        const expectedRange: Range = {
            start: document.textDocument.positionAt(ranges[expectedGoToDefinition.rangeIndex][0]),
            end: document.textDocument.positionAt(ranges[expectedGoToDefinition.rangeIndex][1])
        };
        expectEqual(locationLink.length, 1);
        expectEqual(locationLink[0].targetSelectionRange, expectedRange);
    };
}

export interface ExpectedHover extends ExpectedBase {
    index: number
    hover?: string
}

export function expectHover(services: LangiumServices, cb: ExpectFunction): (expectedHover: ExpectedHover) => Promise<void> {
    return async expectedHover => {
        const { output, indices } = replaceIndices(expectedHover);
        const document = await parseDocument(services, output);
        const hoverProvider = services.lsp.HoverProvider;
        const hover = await hoverProvider.getHoverContent(document, textDocumentPositionParams(document, indices[expectedHover.index]));
        const hoverContent = hover && MarkupContent.is(hover.contents) ? hover.contents.value : undefined;
        cb(hoverContent, expectedHover.hover);
    };
}

function textDocumentPositionParams(document: LangiumDocument, offset: number): TextDocumentPositionParams {
    return { textDocument: { uri: document.textDocument.uri }, position: document.textDocument.positionAt(offset) };
}

export async function parseDocument<T extends AstNode = AstNode>(services: LangiumServices, input: string): Promise<LangiumDocument<T>> {
    const document = await parseHelper<T>(services)(input);
    if (!document.parseResult) {
        throw new Error('Could not parse document');
    }
    return document;
}

function replaceIndices(base: ExpectedBase): { output: string, indices: number[], ranges: Array<[number, number]> } {
    const indices: number[] = [];
    const ranges: Array<[number, number]> = [];
    const rangeStack: number[] = [];
    const indexMarker = base.indexMarker || '<|>';
    const rangeStartMarker = base.rangeStartMarker || '<|';
    const rangeEndMarker = base.rangeEndMarker || '|>';
    const regex = new RegExp(`${escapeRegExp(indexMarker)}|${escapeRegExp(rangeStartMarker)}|${escapeRegExp(rangeEndMarker)}`);

    let matched = true;
    let input = base.text;

    while (matched) {
        const regexMatch = regex.exec(input);
        if (regexMatch) {
            const matchedString = regexMatch[0];
            switch (matchedString) {
                case indexMarker:
                    indices.push(regexMatch.index);
                    break;
                case rangeStartMarker:
                    rangeStack.push(regexMatch.index);
                    break;
                case rangeEndMarker: {
                    const rangeStart = rangeStack.pop() || 0;
                    ranges.push([rangeStart, regexMatch.index]);
                    break;
                }
            }
            input = input.substring(0, regexMatch.index) + input.substring(regexMatch.index + matchedString.length);
        } else {
            matched = false;
        }
    }

    return { output: input, indices, ranges: ranges.sort((a, b) => a[0] - b[0]) };
}

export function validationHelper<T extends AstNode = AstNode>(services: LangiumServices): (input: string) => Promise<Diagnostic[]> {
    const parse = parseHelper(services);
    return async (input) => {
        const document = await parse(input);
        return await services.validation.DocumentValidator.validateDocument(document);
    };
}

export type Predicate<T> = (arg: T) => boolean;

export interface DiagnosticFilters {
    severity: DiagnosticSeverity;
    message: RegExp | string;
}

export type DiagnosticFilterOptions = Partial<DiagnosticFilters>;

function filterByOptions(diagnostics: Diagnostic[], filterOptions?: DiagnosticFilterOptions) {
    const options = filterOptions || {};
    const filters: Predicate<Diagnostic>[] = [];
    if (options.severity) {
        filters.push(d => d.severity === options.severity);
    }
    if (options.message) {
        if (typeof options.message === 'string') {
            filters.push(d => d.message === options.message);
        } else if (options.message instanceof RegExp) {
            const regexp = options.message as RegExp;
            filters.push(d => regexp.test(d.message));
        }
    }
    return diagnostics.filter(diag => filters.every(holdsFor => holdsFor(diag)));
}

export function expectNoIssues(diagnostics: Diagnostic[], filterOptions?: DiagnosticFilterOptions) {
    const filtered = filterByOptions(diagnostics, filterOptions);
    expect(filtered).toHaveLength(0);
}

export function expectIssue(diagnostics: Diagnostic[], filterOptions?: DiagnosticFilterOptions) {
    const filtered = filterByOptions(diagnostics, filterOptions);
    expect(filtered).not.toHaveLength(0);
}

export function expectError(diagnostics: Diagnostic[], message: string | RegExp) {
    expectIssue(diagnostics, {
        message,
        severity: DiagnosticSeverity.Error
    });
}
export function expectWarning(diagnostics: Diagnostic[], message: string | RegExp) {
    expectIssue(diagnostics, {
        message,
        severity: DiagnosticSeverity.Warning
    });
}