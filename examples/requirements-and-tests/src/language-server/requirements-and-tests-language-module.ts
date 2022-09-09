import {
    createDefaultModule, createDefaultSharedModule, DefaultSharedModuleContext, inject,
    LangiumSharedServices
} from 'langium';
import { RequirementsAndTestsGeneratedSharedModule, RequirementsGeneratedModule, TestsGeneratedModule } from './generated/module';
import { RequirementsLanguageModule, RequirementsLanguageServices } from './requirements-language-module';
import { TestsLanguageModule, TestsLanguageServices } from './tests-language-module';

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
export function createRequirementsAndTestsLanguageServices(context?: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    RequirementsLanguage: RequirementsLanguageServices,
    TestsLanguage: TestsLanguageServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        RequirementsAndTestsGeneratedSharedModule
    );
    const RequirementsLanguage = inject(
        createDefaultModule({ shared }),
        RequirementsGeneratedModule,
        RequirementsLanguageModule
    );
    const TestsLanguage = inject(
        createDefaultModule({ shared }),
        TestsGeneratedModule,
        TestsLanguageModule
    );
    shared.ServiceRegistry.register(RequirementsLanguage);
    shared.ServiceRegistry.register(TestsLanguage);
    return { shared, RequirementsLanguage, TestsLanguage };
}