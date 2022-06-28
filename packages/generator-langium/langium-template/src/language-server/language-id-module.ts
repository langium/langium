import {
    createDefaultModule, createDefaultSharedModule, DefaultSharedModuleContext, inject,
    LangiumServices, LangiumSharedServices, Module, PartialLangiumServices
} from 'langium';
import { <%= LanguageName %>GeneratedModule, <%= LanguageName %>GeneratedSharedModule } from './generated/module';
import { <%= LanguageName %>ValidationRegistry, <%= LanguageName %>Validator } from './<%= language-id %>-validator';

/**
 * Declaration of custom services - add your own service classes here.
 */
export type <%= LanguageName %>AddedServices = {
    validation: {
        <%= LanguageName %>Validator: <%= LanguageName %>Validator
    }
}

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type <%= LanguageName %>Services = LangiumServices & <%= LanguageName %>AddedServices

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services. The Langium defaults can be partially specified to override only
 * selected services, while the custom services must be fully specified.
 */
export const <%= LanguageName %>Module: Module<<%= LanguageName %>Services, PartialLangiumServices & <%= LanguageName %>AddedServices> = {
    validation: {
        ValidationRegistry: (services) => new <%= LanguageName %>ValidationRegistry(services),
        <%= LanguageName %>Validator: () => new <%= LanguageName %>Validator()
    }
};

/**
 * Create the full set of services required by Langium.
 *
 * First inject the shared services by merging two modules:
 *  - Langium default shared services
 *  - Services generated by langium-cli
 *
 * Then inject the language-specific services by merging three modules:
 *  - Langium default language-specific services
 *  - Services generated by langium-cli
 *  - Services specified in this file
 *
 * @param context Optional module context with the LSP connection
 * @returns An object wrapping the shared services and the language-specific services
 */
export function create<%= LanguageName %>Services(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    <%= LanguageName %>: <%= LanguageName %>Services
} {
    const shared = inject(
        createDefaultSharedModule(context),
        <%= LanguageName %>GeneratedSharedModule
    );
    const <%= LanguageName %> = inject(
        createDefaultModule({ shared }),
        <%= LanguageName %>GeneratedModule,
        <%= LanguageName %>Module
    );
    shared.ServiceRegistry.register(<%= LanguageName %>);
    return { shared, <%= LanguageName %> };
}
