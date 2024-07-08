# The mandatory language package

As a good entry point to our documentation, please use to this [guide](https://langium.org/docs/learn/workflow/write_grammar/).

## What's in the folder?

- [package.json](./package.json) - The manifest file of your language package.
- [tsconfig.json](./tsconfig.json) - The packages specific TypeScript compiler configuration extending the [base config](../../tsconfig.json)
- [src/<%= language-id %>.langium](src/<%= language-id %>.langium) -  The grammar definition of your language
- [src/<%= language-id %>-module.ts](src/<%= language-id %>-module.ts) - The dependency injection module of your language implementation. Use this to register overridden and added services.
- [src/<%= language-id %>-validator.ts](src/<%= language-id %>-validator.ts) - An example validator. You should change it to reflect the semantics of your language.
- [src/generated/ast.ts](src/generated/ast.ts) - AST generated by `langium generate`.
- [src/generated/grammar.ts](src/generated/grammar.ts) - Grammar generated by `langium generate`.
- [src/generated/module.ts](src/generated/module.ts) - Module generated by `langium generate`.
- [src/syntaxes/<%= language-id %>.monarch.ts](src/syntaxes/<%= language-id %>.monarch.ts) - Monarch based syntax highlighting instructions.
- [syntaxes/<%= language-id %>.tmLanguage.json](syntaxes/<%= language-id %>.tmLanguage.json) - Textmate based syntax highlighting instructions.
- [src/index.ts](src/index.ts) Defines what is exported to other packages.

If you selected the test option as well, then the following files will be present in addition:

- [tsconfig.test.json](./tsconfig.test.json) - The package specific TypeScript compiler configuration for the unit tests extending the [tsconfig.src.config](./tsconfig.src.json)
- [test/linking.test.ts](test/linking.test.ts) - Unit tests checking linking.
- [test/parsing.test.ts](test/parsing.test.ts) - Unit tests regarding parsing.
- [test/validating.test.ts](test/validating.test.ts) - Unit tests regarding validation.