"use strict";

/* eslint global-require: "off" */

const gulp = require('gulp');
const webpack = require('webpack-stream');
const rename = require('gulp-rename');
const terser = require('terser-webpack-plugin');
const sourcemaps = require('gulp-sourcemaps');
const eslint = require("gulp-eslint");
const jsdoc2md = require("jsdoc-to-markdown");
const toc = require('markdown-toc');
const bluebird = require("bluebird");
const fs = bluebird.promisifyAll(require("fs"));
const karma = require('karma');
const Jasmine = require("jasmine");

// Use the latest uglify.
// const uglify = uglifyComposer(uglifyjs, console);

const BROWSERIFY_STANDALONE_NAME = "XlsxPopulate";
const BABEL_CONFIG = {
    presets: [
        ["@babel/preset-env", {
            targets: {
                browsers: ">0.5%"
            }
        }]
    ]
};

const PATHS = {
    lib: "./lib/**/*.js",
    unit: "./test/unit/**/*.js",
    karma: ["./test/helpers/**/*.js", "./test/unit/**/*.spec.js"], // Helpers need to go first
    examples: "./examples/**/*.js",
    browserify: {
        source: "./lib/XlsxPopulate.js",
        base: "./browser",
        bundle: "xlsx-populate.js",
        noEncryptionBundle: "xlsx-populate-no-encryption.js",
        sourceMap: "./",
        encryptionIgnores: ["./lib/Encryptor.js"]
    },
    readme: {
        template: "./docs/template.md",
        build: "./README.md"
    },
    blank: {
        workbook: "./blank/blank.xlsx",
        template: "./blank/template.js",
        build: "./lib/blank.js"
    },
    jasmineConfigs: {
        unit: "./test/unit/jasmine.json",
        e2eGenerate: "./test/e2e-generate/jasmine.json",
        e2eParse: "./test/e2e-parse/jasmine.json"
    }
};

PATHS.lint = [PATHS.lib];
PATHS.unitTestSources = [PATHS.lib, PATHS.unit];

// Function to clear the require cache as running unit tests mess up later tests.
const clearRequireCache = () => {
    for (const moduleId in require.cache) {
        delete require.cache[moduleId];
    }
};

const runKarma = (files, cb) => {
    process.chdir(__dirname);
    new karma.Server({
        files,
        frameworks: ['browserify', 'jasmine'],
        browsers: ['Chrome', 'Firefox', 'IE'],
        preprocessors: {
            "./test/**/*.js": ['browserify']
        },
        plugins: [
            'karma-browserify',
            'karma-chrome-launcher',
            'karma-firefox-launcher',
            'karma-ie-launcher',
            'karma-jasmine'
        ],
        browserify: {
            debug: true,
            transform: [["babelify", BABEL_CONFIG]],
            configure(bundle) {
                bundle.once('prebundle', () => {
                    bundle.transform('babelify').plugin('proxyquire-universal');
                });
            }
        },
        singleRun: true,
        autoWatch: false,
        captureTimeout: 210000,
        browserDisconnectTolerance: 3,
        browserDisconnectTimeout: 210000,
        browserNoActivityTimeout: 210000
    }, cb).start();
};

const runJasmine = (configPath, cb) => {
    process.chdir(__dirname);
    clearRequireCache();
    const jasmine = new Jasmine();
    jasmine.loadConfigFile(configPath);
    jasmine.onComplete(passed => cb(null));
    jasmine.execute();
};

const runWebpack = (ignores, bundleName) => {
    const plugins = [
        new webpack.webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser',
        })
    ];

    if (ignores.length > 0) {
        plugins.push(new webpack.webpack.IgnorePlugin({
            resourceRegExp: new RegExp(ignores.join('|').replace(/\./g, '\\.').replace(/\//g, '\\/'))
        }));
    }

    const config = {
        mode: 'production',
        entry: PATHS.browserify.source,
        output: {
            filename: bundleName,
            library: BROWSERIFY_STANDALONE_NAME,
            libraryTarget: 'umd',
            globalObject: 'this'
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    use: {
                        loader: 'babel-loader',
                        options: BABEL_CONFIG
                    }
                }
            ]
        },
        resolve: {
            fallback: {
                "crypto": require.resolve("crypto-browserify"),
                "buffer": require.resolve("buffer/"),
                "stream": require.resolve("stream-browserify"),
                "vm": require.resolve("vm-browserify"),
                "fs": false,
                "path": false
            }
        },
        plugins: plugins,
        optimization: {
            minimize: false
        },
        devtool: 'source-map'
    };

    // Stream for unminified
    const unminified = gulp.src(PATHS.browserify.source)
        .pipe(webpack(config))
        .pipe(rename(bundleName))
        .pipe(gulp.dest(PATHS.browserify.base));
    
    // Config for minified
    const configMin = Object.assign({}, config, {
        optimization: {
            minimize: true,
            minimizer: [new terser({
                extractComments: false,
            })],
        },
        output: {
             filename: bundleName.replace('.js', '.min.js'),
             library: BROWSERIFY_STANDALONE_NAME,
             libraryTarget: 'umd',
             globalObject: 'this'
        }
    });

    return gulp.src(PATHS.browserify.source)
        .pipe(webpack(configMin))
        .pipe(gulp.dest(PATHS.browserify.base));
};

const browserifyTask = () => runWebpack([], PATHS.browserify.bundle);
const browserifyNoEncryption = () => runWebpack(PATHS.browserify.encryptionIgnores, PATHS.browserify.noEncryptionBundle);

const blank = async () => {
    const data = await fs.readFileAsync(PATHS.blank.workbook, "base64");
    const template = await fs.readFileAsync(PATHS.blank.template, "utf8");
    const output = template.replace("{{DATA}}", data);
    return fs.writeFileAsync(PATHS.blank.build, output);
};

const docs = () => {
    return fs.readFileAsync(PATHS.readme.template, "utf8")
        .then(text => {
            const tocText = toc(text, { filter: str => str.indexOf('NOTOC-') === -1 }).content;
            text = text.replace("<!-- toc -->", tocText);
            text = text.replace(/NOTOC-/mg, "");
            return jsdoc2md.render({ files: PATHS.lib })
                .then(apiText => {
                    apiText = apiText.replace(/^#/mg, "##");
                    text = text.replace("<!-- api -->", apiText);
                    return fs.writeFileAsync(PATHS.readme.build, text);
                });
        });
};

const browserFull = gulp.series(blank, browserifyTask);

const browserNoEncryption = gulp.series(blank, browserifyNoEncryption);

const browser = gulp.series(browserFull, browserNoEncryption);

const lint = () => {
    return gulp
        .src(PATHS.lint)
        .pipe(eslint())
        .pipe(eslint.format());
};

const unit = cb => {
    runJasmine(PATHS.jasmineConfigs.unit, cb);
};

const e2eGenerate = cb => {
    runJasmine(PATHS.jasmineConfigs.e2eGenerate, cb);
};

const e2eParse = cb => {
    runJasmine(PATHS.jasmineConfigs.e2eParse, cb);
};

const e2eBrowser = cb => {
    runKarma(["./test/helpers/**/*.js", "./browser/xlsx-populate.js", "./test/e2e-browser/**/*.spec.js"], cb);
};

const unitBrowser = cb => {
    runKarma(PATHS.karma, cb);
};

const watch = () => {
    // Only watch blank, unit, and docs for changes. Everything else is too slow or noisy.
    gulp.watch([PATHS.blank.template, PATHS.blank.workbook], blank);
    gulp.watch(PATHS.unitTestSources, unit);
    gulp.watch([PATHS.lib, PATHS.readme.template], docs);
};

const build = gulp.series(docs, browser, lint, unit, unitBrowser, e2eParse, e2eGenerate, e2eBrowser);

const defaultTask = gulp.series(blank, unit, docs, watch);

exports.blank = blank;
exports.docs = docs;
exports.browser = browser;
exports.lint = lint;
exports.unit = unit;
exports['unit-browser'] = unitBrowser;
exports['e2e-parse'] = e2eParse;
exports['e2e-generate'] = e2eGenerate;
exports['e2e-browser'] = e2eBrowser;
exports.build = build;
exports.default = defaultTask;
