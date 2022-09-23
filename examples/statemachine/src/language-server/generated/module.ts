/******************************************************************************
 * This file was generated by langium-cli 0.4.0.
 * DO NOT EDIT MANUALLY!
 ******************************************************************************/

import { LangiumGeneratedServices, LangiumGeneratedSharedServices, LangiumSharedServices, LangiumServices, LanguageMetaData, Module } from 'langium';
import { StatemachineAstReflection } from './ast';
import { StatemachineGrammar } from './grammar';

export const StatemachineLanguageMetaData: LanguageMetaData = {
    languageId: 'statemachine',
    fileExtensions: ['.statemachine'],
    caseInsensitive: false,
    showNonAlphabeticKeywords: false
};

export const StatemachineGeneratedSharedModule: Module<LangiumSharedServices, LangiumGeneratedSharedServices> = {
    AstReflection: () => new StatemachineAstReflection()
};

export const StatemachineGeneratedModule: Module<LangiumServices, LangiumGeneratedServices> = {
    Grammar: () => StatemachineGrammar(),
    LanguageMetaData: () => StatemachineLanguageMetaData,
    parser: {}
};
