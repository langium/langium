/******************************************************************************
 * Copyright 2021 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { AstNodeDescription, Scope, ScopeOptions } from 'langium';
import { MapScope } from 'langium';
import { DefaultScopeProvider, stream, StreamScope } from 'langium';

/**
 * Special scope provider that matches symbol names regardless of lowercase or uppercase.
 */
export class ArithmeticsScopeProvider extends DefaultScopeProvider {

    protected override createScope(elements: Iterable<AstNodeDescription>, outerScope: Scope, options?: ScopeOptions): Scope {
        return new StreamScope(stream(elements), outerScope, { ...options, caseInsensitive: true });
    }

    protected override getGlobalScope(referenceType: string): Scope {
        let scope = this.globalScopeCache.get(referenceType);
        if (!scope) {
            scope = new MapScope(this.indexManager.allElements(referenceType), undefined, { caseInsensitive: true });
            this.globalScopeCache.set(referenceType, scope);
        }
        return scope;
    }

}
