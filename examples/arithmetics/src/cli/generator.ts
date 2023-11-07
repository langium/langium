/******************************************************************************
 * Copyright 2023 TypeFox GmbH
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 ******************************************************************************/

import type { Module } from '../language-server/generated/ast.js';
import { NodeFileSystem } from 'langium/node';
import { createArithmeticsServices } from '../language-server/arithmetics-module.js';
import { ArithmeticsLanguageMetaData } from '../language-server/generated/module.js';
import { extractAstNode } from './cli-util.js';
import chalk from 'chalk';
import { generateLLVMIR } from './llvm-ir-generator.js';
import * as path from 'path';
import * as fs from 'node:fs';

type GenerateOptions = {
    destination?: string;
    target?: 'll' | 'py';
    return?: boolean;
}

export const generateAction = async (fileName: string, opts: GenerateOptions): Promise<void> => {
    const services = createArithmeticsServices(NodeFileSystem).arithmetics;
    const module = await extractAstNode<Module>(fileName, ArithmeticsLanguageMetaData.fileExtensions, services);

    const filePathData = extractDestinationAndName(module.name, opts.destination);
    if (!fs.existsSync(filePathData.destination)) {
        fs.mkdirSync(filePathData.destination, { recursive: true });
    }

    if (opts.target === undefined || opts.target === 'll') {
        const generatedFilePath = `${path.join(filePathData.destination, filePathData.name)}.ll`;
        const fileContent = generateLLVMIR(module, fileName, opts.return ?? false);
        if (fileContent !== 'error') {
            fs.writeFileSync(generatedFilePath, fileContent);
            console.log(chalk.green(`LLVM IR code generated successfully: ${generatedFilePath}`));
        } else {
            console.log(chalk.red('LLVM IR code generation failed!'));
        }
    }
};

function extractDestinationAndName(filePath: string, destination: string | undefined): FilePathData {
    filePath = path.basename(filePath, path.extname(filePath)).replace(/[.-]/g, '');
    return {
        destination: destination ?? path.join(path.dirname(filePath), 'generated'),
        name: path.basename(filePath)
    };
}
interface FilePathData {
    destination: string,
    name: string
}
