"use strict";

const path = require("path");
const fs = require("fs");
const chalk = require("chalk");
const parse = require("..").parse;

function list_files(root, dir) {
  const files = fs.readdirSync(dir ? path.join(root, dir) : root);
  let result = [];
  for (let i = 0; i < files.length; i++) {
    const file = dir ? path.join(dir, files[i]) : files[i];
    const stats = fs.statSync(path.join(root, file));
    if (stats.isDirectory()) {
      result = result.concat(list_files(root, file));
    } else {
      result.push(file);
    }
  }
  return result.sort();
}

function get_tests(root_dir) {
  const files = list_files(root_dir);
  const tests = {};
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const test_name = path.dirname(file);
    const case_parts = path.basename(file).split(".");
    const case_name = case_parts[0];

    // Hack to ignore hidden files.
    if (case_name === "") {
      continue;
    }

    const cases = (tests[test_name] = tests[test_name] || {});
    const case_ = (cases[case_name] = cases[case_name] || {});

    const content = fs.readFileSync(path.join(root_dir, file), {
      encoding: "utf8",
    });
    const ext = case_parts[case_parts.length - 1];
    const kind =
      case_parts.length > 2 ? case_parts[case_parts.length - 2] : null;

    if (ext === "js") {
      case_.name = case_name;
      case_.content = content;
    } else if (ext === "json" && kind === "tree") {
      case_.expected_ast = JSON.parse(content);
    } else if (ext === "json" && kind === "options") {
      case_.options = JSON.parse(content);
    }
  }
  return tests;
}

function get_hardcoded_tests() {
  const tests = get_tests(
    path.join(__dirname, "../build/flow/src/parser/test/flow")
  );
  const result = {};
  for (const section in tests) {
    if (tests.hasOwnProperty(section)) {
      const test = tests[section];
      const cases = [];
      // TODO: use Object.values if we require new enough node
      for (const case_ in test) {
        if (test.hasOwnProperty(case_)) {
          cases.push(test[case_]);
        }
      }
      result[section] = { tests: cases };
    }
  }
  return result;
}

const options = {
  plugins: ["jsx", "flow", "asyncGenerators", "objectRestSpread"],
  sourceType: "module",
  ranges: true,
};

const flowOptionsMapping = {
  esproposal_class_instance_fields: "classProperties",
  esproposal_class_static_fields: "classProperties",
  esproposal_export_star_as: "exportExtensions",
  esproposal_decorators: "decorators",
};

let failedTests = 0;
let successTests = 0;
const hardcodedTests = get_hardcoded_tests();
Object.keys(hardcodedTests).forEach(sectionName => {
  console.log("");
  console.log(`### ${sectionName} ###`);
  hardcodedTests[sectionName].tests.forEach(test => {
    const shouldSuccess =
      test.expected_ast &&
      (!Array.isArray(test.expected_ast.errors) ||
        test.expected_ast.errors.length === 0);

    const babylonOptions = Object.assign({}, options);
    babylonOptions.plugins = babylonOptions.plugins.slice();

    if (test.options) {
      Object.keys(test.options).forEach(option => {
        if (!test.options[option]) return;
        if (!flowOptionsMapping[option])
          throw new Error("Parser options not mapped " + option);
        babylonOptions.plugins.push(flowOptionsMapping[option]);
      });
    }

    let failed = false;
    let exception = null;
    try {
      parse(test.content, babylonOptions);
    } catch (e) {
      exception = e;
      failed = true;
      // lets retry in script mode
      try {
        parse(
          test.content,
          Object.assign({}, babylonOptions, { sourceType: "script" })
        );
        exception = null;
        failed = false;
      } catch (e) {}
    }

    if ((!failed && shouldSuccess) || (failed && !shouldSuccess)) {
      successTests++;
      console.log(chalk.green(`✔ ${test.name}`));
    } else {
      failedTests++;
      printErrorMessage(
        test.name,
        exception,
        shouldSuccess,
        test.expected_ast,
        babylonOptions
      );
    }
  });
});

function printErrorMessage(
  code,
  exception,
  shouldSuccess,
  expectedAst,
  babylonOptions
) {
  console.log(chalk.red(`✘ ${code}`));
  console.log(
    chalk.yellow(
      `  Should ${shouldSuccess
        ? "parse successfully"
        : `fail parsing`}, but did not`
    )
  );
  if (exception)
    console.log(chalk.yellow(`  Failed with: \`${exception.message}\``));
  if (Array.isArray(expectedAst.errors) && expectedAst.errors.length > 0) {
    console.log(chalk.yellow("  Expected error message similar to:"));
    expectedAst.errors.forEach(error => {
      console.log(`    • ${error.message}`);
    });
  }

  console.log(
    chalk.yellow(`  Active plugins: ${JSON.stringify(babylonOptions.plugins)}`)
  );
}

console.log();
console.log(chalk.green(`✔ ${successTests} tests passed`));
console.log(chalk.red(`✘ ${failedTests} tests failed`));

process.exit(failedTests > 0 ? 1 : 0);
