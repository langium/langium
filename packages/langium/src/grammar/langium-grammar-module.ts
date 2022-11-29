/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import { createDefaultModule, createDefaultSharedModule, DefaultSharedModuleContext } from '../default-module';
import { inject, Module } from '../dependency-injection';
import { LangiumServices, LangiumSharedServices, PartialLangiumServices, PartialLangiumSharedServices } from '../services';
import { LangiumGrammarGeneratedModule, LangiumGrammarGeneratedSharedModule } from './generated/module';
import { LangiumGrammarScopeComputation, LangiumGrammarScopeProvider } from './references/grammar-scope';
import { LangiumGrammarValidationRegistry, LangiumGrammarValidator } from './langium-grammar-validator';
import { LangiumGrammarCodeActionProvider } from './lsp/grammar-code-actions';
import { LangiumGrammarFoldingRangeProvider } from './lsp/grammar-folding-ranges';
import { LangiumGrammarFormatter } from './lsp/grammar-formatter';
import { LangiumGrammarSemanticTokenProvider } from './lsp/grammar-semantic-tokens';
import { LangiumGrammarNameProvider } from './references/grammar-naming';
import { LangiumGrammarReferences } from './references/grammar-references';
import { LangiumGrammarDefinitionProvider } from './lsp/grammar-definition';
import { LangiumGrammarCallHierarchyProvider } from './lsp/grammar-call-hierarchy';
import { LangiumGrammarDocumentBuilder } from './workspace/document-builder';
import { LangiumGrammarTypeCollector } from './workspace/type-collector';

export type LangiumGrammarAddedServices = {
    validation: {
        LangiumGrammarValidator: LangiumGrammarValidator
    }
}

export type LangiumGrammarServices = LangiumServices & LangiumGrammarAddedServices & {
    shared: LangiumGrammarSharedServices
}

export const LangiumGrammarModule: Module<LangiumGrammarServices, PartialLangiumServices & LangiumGrammarAddedServices> = {
    validation: {
        ValidationRegistry: (services) => new LangiumGrammarValidationRegistry(services),
        LangiumGrammarValidator: (services) => new LangiumGrammarValidator(services)
    },
    lsp: {
        FoldingRangeProvider: (services) => new LangiumGrammarFoldingRangeProvider(services),
        CodeActionProvider: (services) => new LangiumGrammarCodeActionProvider(services),
        SemanticTokenProvider: (services) => new LangiumGrammarSemanticTokenProvider(services),
        Formatter: () => new LangiumGrammarFormatter(),
        DefinitionProvider: (services) => new LangiumGrammarDefinitionProvider(services),
        CallHierarchyProvider: (services) => new LangiumGrammarCallHierarchyProvider(services)
    },
    references: {
        ScopeComputation: (services) => new LangiumGrammarScopeComputation(services),
        ScopeProvider: (services) => new LangiumGrammarScopeProvider(services),
        References: (services) => new LangiumGrammarReferences(services),
        NameProvider: () => new LangiumGrammarNameProvider()
    }
};

export type LangiumGrammarAddedSharedServices = {
    workspace: {
        TypeCollector: LangiumGrammarTypeCollector
    }
}

export type LangiumGrammarSharedServices = LangiumSharedServices & LangiumGrammarAddedSharedServices

export const LangiumGrammarSharedModule = {
    workspace: {
        DocumentBuilder: (services: LangiumGrammarSharedServices) => new LangiumGrammarDocumentBuilder(services),
        TypeCollector: () => new LangiumGrammarTypeCollector(),
    }
};

export function createLangiumGrammarServices(context: DefaultSharedModuleContext,
    sharedModule?: Module<LangiumSharedServices, PartialLangiumSharedServices>): {
        shared: LangiumGrammarSharedServices,
        grammar: LangiumGrammarServices
    } {
    const shared = inject(
        createDefaultSharedModule(context),
        LangiumGrammarGeneratedSharedModule,
        {
            ...(sharedModule ?? {}),
            workspace: {
                ...LangiumGrammarSharedModule.workspace,
                ...(sharedModule?.workspace ?? {})
            }
        }
    );
    const grammar = inject(
        createDefaultModule({ shared }),
        LangiumGrammarGeneratedModule,
        LangiumGrammarModule
    );
    shared.ServiceRegistry.register(grammar);
    return { shared, grammar };
}
