/******************************************************************************
 * This file was generated by langium-cli 0.4.0.
 * DO NOT EDIT MANUALLY!
 ******************************************************************************/

import { LangiumGeneratedServices, LangiumGeneratedSharedServices, LangiumSharedServices, LangiumServices, LanguageMetaData, Module } from 'langium';
import { RequirementsAndTestsAstReflection } from './ast';
import { RequirementsGrammar, TestsGrammar } from './grammar';

export const RequirementsLanguageMetaData: LanguageMetaData = {
    languageId: 'requirements-lang',
    fileExtensions: ['.req'],
    caseInsensitive: false
};

export const TestsLanguageMetaData: LanguageMetaData = {
    languageId: 'tests-lang',
    fileExtensions: ['.tst'],
    caseInsensitive: false
};

export const RequirementsAndTestsGeneratedSharedModule: Module<LangiumSharedServices, LangiumGeneratedSharedServices> = {
    AstReflection: () => new RequirementsAndTestsAstReflection()
};

export const RequirementsGeneratedModule: Module<LangiumServices, LangiumGeneratedServices> = {
    Grammar: () => RequirementsGrammar(),
    LanguageMetaData: () => RequirementsLanguageMetaData,
    parser: {}
};

export const TestsGeneratedModule: Module<LangiumServices, LangiumGeneratedServices> = {
    Grammar: () => TestsGrammar(),
    LanguageMetaData: () => TestsLanguageMetaData,
    parser: {}
};
