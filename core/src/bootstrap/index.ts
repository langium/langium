/* eslint-disable */
import * as fs from "fs";
import { parseXtext } from "./xtext-parser";
import { buildGrammar, linkGrammar } from "./ast-builder";
import { generateParser } from "../generator/parser-generator";
import { generateAst } from "../generator/ast-generator";
import { parse } from "../gen/parser";

const input = fs.readFileSync("test.xtext").toString();
const result = parseXtext(input);

const ast = buildGrammar(result.cst);
linkGrammar(ast);

const parser = generateParser(ast);
const genAst = generateAst(ast);
fs.mkdirsSync("src/gen");
fs.writeFileSync("src/gen/parser.ts", parser);
fs.writeFileSync("src/gen/ast.ts", genAst);

const output = parse(input);
debugger;