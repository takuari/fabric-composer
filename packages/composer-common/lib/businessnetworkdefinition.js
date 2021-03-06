/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const Logger = require('./log/logger');
const ModelManager = require('./modelmanager');
const Introspector = require('./introspect/introspector');
const AclManager = require('./aclmanager');
const AclFile = require('./acl/aclfile');
const Factory = require('./factory');
const Serializer = require('./serializer');
const ScriptManager = require('./scriptmanager');
const JSZip = require('jszip');
const semver = require('semver');
const fs = require('fs');
const fsPath = require('path');
const minimatch = require('minimatch');

const ENCODING = 'utf8';
const LOG = Logger.getLog('BusinessNetworkDefinition');

/**
 * <p>
 * A BusinessNetworkDefinition defines a set of Participants that exchange Assets by
 * sending Transactions. This class manages the metadata and domain-specific types for
 * the network as well as a set of executable scripts.
 * </p>
 * @class
 * @memberof module:composer-common
 */
class BusinessNetworkDefinition {

    /**
     * Create the BusinessNetworkDefinition.
     * <p>
     * <strong>Note: Only to be called by framework code. Applications should
     * retrieve instances from {@link BusinessNetworkDefinition.fromArchive}</strong>
     * </p>
     * @param {String} identifier  - the identifier of the business network. The
     * identifier is formed from a business network name + '@' + version. The
     * version is a semver valid version string.
     * @param {String} description  - the description of the business network
     */
    constructor(identifier, description) {
        const method = 'constructor';
        LOG.entry(method, identifier, description);
        this.identifier = identifier;

        const atIndex = this.identifier.lastIndexOf('@');

        if (atIndex >= 0) {
            this.name = this.identifier.substring(0, atIndex);
        } else {
            throw new Error('Malformed business network identifier. It must be "name@major.minor.micro"');
        }

        this.version = this.identifier.substring(atIndex + 1);
        if (!semver.valid(this.version)) {
            throw new Error('Version number is invalid. Should be valid according to semver but found: ' + this.version);
        }

        this.description = description;
        this.modelManager = new ModelManager();
        this.aclManager = new AclManager(this.modelManager);
        this.scriptManager = new ScriptManager(this.modelManager);
        this.introspector = new Introspector(this.modelManager);
        this.factory = new Factory(this.modelManager);
        this.serializer = new Serializer(this.factory, this.modelManager);
        LOG.exit(method);
    }

    /**
     * Returns the identifier for this business network
     * @return {String} the identifier of this business network
     */
    getIdentifier() {
        return this.identifier;
    }

    /**
     * Returns the name for this business network
     * @return {String} the name of this business network
     */
    getName() {
        return this.name;
    }

    /**
     * Returns the version for this business network
     * @return {String} the version of this business network. Use semver module
     * to parse.
     */
    getVersion() {
        return this.version;
    }


    /**
     * Returns the description for this business network
     * @return {String} the description of this business network
     */
    getDescription() {
        return this.description;
    }

    /**
     * Create a BusinessNetworkDefinition from an archive.
     * @param {Buffer} Buffer  - the Buffer to a zip archive
     * @return {Promise} a Promise to the instantiated business network
     */
    static fromArchive(Buffer) {
        const method = 'fromArchive';
        LOG.entry(method, Buffer.length);
        return JSZip.loadAsync(Buffer).then(function(zip) {
            const allPromises = [];
            let ctoModelFiles = [];
            let ctoModelFileNames = [];
            let jsScriptFiles = [];
            let permissionsFiles = [];
            let businessNetworkDefinition;

            LOG.debug(method, 'Loading package.json');
            let packageJson = zip.file('package.json');
            if (packageJson === null) {
                throw Error('package.json must exist');
            }
            const packagePromise = packageJson.async('string');
            allPromises.push(packagePromise);
            packagePromise.then(contents => {
                LOG.debug(method, 'Loaded package.json');
                let jsonObject = JSON.parse(contents);
                let packageName = jsonObject.name;
                let packageVersion = jsonObject.version;
                let packageDescription = jsonObject.description;
                businessNetworkDefinition = new BusinessNetworkDefinition(packageName + '@' + packageVersion, packageDescription);
            });

            LOG.debug(method, 'Looking for model files');
            let ctoFiles = zip.file(/models\/.*\.cto$/); //Matches any file which is in the 'models' folder and has a .cto extension
            ctoFiles.forEach(function(file) {
                LOG.debug(method, 'Found model file, loading it', file.name);
                ctoModelFileNames.push(file.name);
                const ctoPromise = file.async('string');
                allPromises.push(ctoPromise);
                ctoPromise.then(contents => {
                    LOG.debug(method, 'Loaded model file');
                    ctoModelFiles.push(contents);
                });
            });

            LOG.debug(method, 'Looking for JavaScript files');
            let jsFiles = zip.file(/lib\/.*\.js$/); //Matches any file which is in the 'lib' folder and has a .js extension
            jsFiles.forEach(function(file) {
                LOG.debug(method, 'Found JavaScript file, loading it', file.name);
                const jsPromise = file.async('string');
                allPromises.push(jsPromise);
                jsPromise.then(contents => {
                    LOG.debug(method, 'Loaded JavaScript file');
                    let tempObj = {
                        'name': file.name,
                        'contents': contents
                    };
                    jsScriptFiles.push(tempObj);

                });
            });

            LOG.debug(method, 'Loading permissions.acl');
            let aclFile = zip.file('permissions.acl');
            if (aclFile !== null) {
                const aclPromise = aclFile.async('string');
                allPromises.push(aclPromise);
                aclPromise.then(contents => {
                    LOG.debug(method, 'Loaded permissions.acl');
                    permissionsFiles.push(contents);
                });
            }

            return Promise.all(allPromises)
                .then(() => {
                    LOG.debug(method, 'Loaded all model, JavaScript, and ACL files');
                    LOG.debug(method, 'Adding model files to model manager');
                    businessNetworkDefinition.modelManager.addModelFiles(ctoModelFiles,ctoModelFileNames); // Adds all cto files to model manager
                    LOG.debug(method, 'Added model files to model manager');
                    // console.log('What are the jsObjectsArray?',jsObjectArray);
                    LOG.debug(method, 'Adding JavaScript files to script manager');
                    jsScriptFiles.forEach(function(obj) {
                        let jsObject = businessNetworkDefinition.scriptManager.createScript(obj.name, 'js', obj.contents);
                        businessNetworkDefinition.scriptManager.addScript(jsObject); // Adds all js files to script manager
                    });
                    LOG.debug(method, 'Added JavaScript files to script manager');
                    LOG.debug(method, 'Adding ACL files to ACL manager');
                    permissionsFiles.forEach((permissionFile) => {
                        businessNetworkDefinition.getAclManager().setAclFile( new AclFile('permissions.acl', businessNetworkDefinition.getModelManager(), permissionFile));
                    });
                    LOG.debug(method, 'Added ACL files to ACL manager');

                    LOG.exit(method, businessNetworkDefinition.toString());
                    return businessNetworkDefinition; // Returns business network (with model manager and script manager)
                });
        });
    }

    /**
     * Store a BusinessNetworkDefinition as an archive.
     * @return {Buffer} buffer  - the zlib buffer
     */
    toArchive() {

        let zip = new JSZip();

        let packageFileContents = JSON.stringify({
            name: this.name,
            version: this.version,
            description: this.description
        });

        zip.file('package.json', packageFileContents);

        const aclFile = this.getAclManager().getAclFile();
        if(aclFile) {
            zip.file(aclFile.getIdentifier(), aclFile.definitions);
        }

        let modelManager = this.getModelManager();
        let modelFiles = modelManager.getModelFiles();
        modelFiles.forEach(function(file) {
            zip.folder('models').file(file.namespace + '.cto', file.definitions);
        });

        let scriptManager = this.getScriptManager();
        let scriptFiles = scriptManager.getScripts();
        scriptFiles.forEach(function(file) {
            let fileIdentifier = file.identifier;
            let fileName = fileIdentifier.substring(fileIdentifier.lastIndexOf('/') + 1);
            zip.folder('lib').file(fileName, file.contents);
        });

        return zip.generateAsync({
            type: 'nodebuffer'
        }).then(something => {
            return Promise.resolve(something).then(result => {
                return result;
            });

        });

    }

    /**
     * Builds a BusinessNetworkDefintion from the contents of a directory.
     * The directory must include a package.json in the root (used to specify
     * the name, version and description of the business network). This method
     * is designed to work with business networks that refer to external models
     * using npm dependencies as well as business networks that statically
     * package their model files.
     * <p>
     * If package.json contains a dependencies property then this method will search for
     * model (CTO) files under the node_modules directory for each dependency that
     * passes the options.dependencyGlob pattern.
     * </p>
     * <p>
     * In addition all model files will be added that are not under node_modules
     * and that pass the options.modelFileGlob pattern. By default you should put
     * model files under a directory called 'models'.
     * </p>
     * <p>
     * All script (js) files will be added that are not under node_modules and
     * that pass the options.scriptGlob pattern. By default you should put Javascript
     * files under the 'lib' directory.
     * </p>
     *
     * @param {String} path to a local directory
     * @param {Object} [options] - an optional set of options to configure the instance.
     * @param {Object} [options.dependencyGlob] - specify the glob pattern used to match
     * the npm dependencies to process. Defaults to **
     * @param {boolean} [options.modelFileGlob] - specify the glob pattern used to match
     * the model files to include. Defaults to **\/models/**\/*.cto
     * @param {boolean} [options.scriptGlob] - specify the glob pattern used to match
     * the script files to include. Defaults to **\/lib/**\/*.js
     * @return {Promise} a Promise to the instantiated business network
     */
    static fromDirectory(path, options) {

        if(!options) {
            options = {};
        }

        if(!options.dependencyGlob) {
            options.dependencyGlob = '**';
        }

        if(!options.modelFileGlob) {
            options.modelFileGlob = '**/models/**/*.cto';
        }

        if(!options.scriptGlob) {
            options.scriptGlob = '**/lib/**/*.js';
        }

        const method = 'fromDirectory';
        LOG.entry(method, path);

        // grab the package.json
        let packageJsonContents = fs.readFileSync( fsPath.resolve(path, 'package.json'), ENCODING);

        if(!packageJsonContents) {
            throw new Error('Failed to find package.json');
        }

        LOG.debug(method, 'Loaded package.json', packageJsonContents);

        // parse the package.json
        let jsonObject = JSON.parse(packageJsonContents);
        let packageName = jsonObject.name;
        let packageVersion = jsonObject.version;
        let packageDescription = jsonObject.description;

        // create the business network definition
        const businessNetwork = new BusinessNetworkDefinition(packageName + '@' + packageVersion, packageDescription);
        const modelFiles = [];
        const modelFileNames = [];

        // process each module dependency
        // filtering using a glob on the module dependency name
        if(jsonObject.dependencies) {
            LOG.debug(method, 'All dependencies', Object.keys(jsonObject.dependencies).toString());
            const dependencies = Object.keys(jsonObject.dependencies).filter(minimatch.filter(options.dependencyGlob));
            LOG.debug(method, 'Matched dependencies', dependencies);

            for( let dep of dependencies) {
                // find all the *.cto files under the npm install dependency path
                let dependencyPath = fsPath.resolve(path, 'node_modules', dep);
                LOG.debug(method, 'Checking dependency path', dependencyPath);
                if (!fs.existsSync(dependencyPath)) {
                    // need to check to see if this is in a peer directory as well
                    //
                    LOG.debug(method,'trying different path '+path.replace(packageName,''));
                    dependencyPath = fsPath.resolve(path.replace(packageName,''),dep);
                    if(!fs.existsSync(dependencyPath)){
                        throw new Error('npm dependency path ' + dependencyPath + ' does not exist. Did you run npm install?');
                    }
                }

                BusinessNetworkDefinition.processDirectory(dependencyPath, {
                    accepts: function(file) {
                        return minimatch(file, options.modelFileGlob);
                    },
                    acceptsDir: function(dir) {
                        return true;
                    },
                    process: function(path,contents) {
                        modelFiles.push(contents);
                        LOG.debug(method, 'Found model file', path);
                    }
                });
            }
        }

        // define a help function that will filter out files
        // that are inside a node_modules directory under the path
        // we are processing
        const isFileInNodeModuleDir = function(file) {
            const method = 'isFileInNodeModuleDir';
            let filePath = fsPath.parse(file);
            let subPath = filePath.dir.substring(path.length);
            let result = subPath.split(fsPath.sep).some((element) => {
                return element === 'node_modules';
            });

            LOG.debug(method, file, result);
            return result;
        };

        // find CTO files outside the npm install directory
        //
        BusinessNetworkDefinition.processDirectory(path, {
            accepts: function(file) {
                return isFileInNodeModuleDir(file) === false && minimatch(file, options.modelFileGlob);
            },
            acceptsDir: function(dir) {
                return !isFileInNodeModuleDir(dir);
            },
            process: function(path,contents) {
                modelFiles.push(contents);
                modelFileNames.push(path);
                LOG.debug(method, 'Found model file', path);
            }
        });

        businessNetwork.getModelManager().addModelFiles(modelFiles,modelFileNames);
        LOG.debug(method, 'Added model files',  modelFiles.length);

        // find script files outside the npm install directory
        const scriptFiles = [];
        BusinessNetworkDefinition.processDirectory(path, {
            accepts: function(file) {
                return isFileInNodeModuleDir(file) === false && minimatch(file, options.scriptGlob);
            },
            acceptsDir: function(dir) {
                return !isFileInNodeModuleDir(dir);
            },
            process: function(path,contents) {
                let filePath = fsPath.parse(path);
                const jsScript = businessNetwork.getScriptManager().createScript(path, filePath.ext.toLowerCase(), contents);
                scriptFiles.push(jsScript);
                LOG.debug(method, 'Found script file ', path);
            }
        });

        if(modelFiles.length === 0) {
            throw new Error('Failed to find a model file.');
        }

        for( let script of scriptFiles) {
            businessNetwork.getScriptManager().addScript(script);
        }

        LOG.debug(method, 'Added script files', scriptFiles.length);

        // grab the permissions.acl
        const aclPath = fsPath.resolve(path, 'permissions.acl');
        if(fs.existsSync(aclPath)) {
            let permissionsAclContents = fs.readFileSync( aclPath, ENCODING);

            if(permissionsAclContents) {
                LOG.debug(method, 'Loaded permissions.acl', permissionsAclContents);
                const aclFile = new AclFile('permissions.acl', businessNetwork.getModelManager(), permissionsAclContents);
                businessNetwork.getAclManager().setAclFile(aclFile);
            }
        }

        LOG.exit(method, path);
        return Promise.resolve(businessNetwork);
    }

    /**
     * @param {String} path - the path to process
     * @param {Object} fileProcessor - the file processor. It must have
     * accept and process methods.
     * @private
     */
    static processDirectory(path, fileProcessor) {
        const items = BusinessNetworkDefinition.walkSync(path, [], fileProcessor);
        items.sort();
        LOG.debug('processDirectory', 'Path ' + path, items);
        items.forEach((item) => {
            BusinessNetworkDefinition.processFile(item, fileProcessor);
        });
    }

    /**
     * @param {String} file - the file to process
     * @param {Object} fileProcessor - the file processor. It must have
     * accepts and process methods.
     * @private
     */
    static processFile(file, fileProcessor) {

        if (fileProcessor.accepts(file)) {
            LOG.debug('processFile', 'FileProcessor accepted', file );
            let fileContents = fs.readFileSync(file, ENCODING);
            fileProcessor.process(file, fileContents);
        }
        else {
            LOG.debug('processFile', 'FileProcessor rejected', file );
        }
    }


    /**
     * @param {String} dir - the dir to walk
     * @param {Object[]} filelist - input files
     * @param {Object} fileProcessor - the file processor. It must have
     * accepts and process methods.
     * @return {Object[]} filelist - output files
     * @private
     */
    static walkSync(dir, filelist, fileProcessor) {
        let files = fs.readdirSync(dir);
        files.forEach(function (file) {
            let nestedPath = fsPath.join(dir, file);
            if (fs.lstatSync(nestedPath).isDirectory()) {
                if (fileProcessor.acceptsDir(nestedPath)) {
                    filelist = BusinessNetworkDefinition.walkSync(nestedPath, filelist, fileProcessor);
                }
            } else {
                filelist.push(nestedPath);
            }
        });
        return filelist;
    }


    /**
     * Visitor design pattern
     * @param {Object} visitor - the visitor
     * @param {Object} parameters  - the parameter
     * @return {Object} the result of visiting or null
     * @private
     */
    accept(visitor, parameters) {
        return visitor.visit(this, parameters);
    }

    /**
     * Provides access to the Introspector for this business network. The Introspector
     * is used to reflect on the types defined within this business network.
     * @return {Introspector} the Introspector for this business network
     */
    getIntrospector() {
        return this.introspector;
    }

    /**
     * Provides access to the Factory for this business network. The Factory
     * is used to create the types defined in this business network.
     * @return {Factory} the Factory for this business network
     */
    getFactory() {
        return this.factory;
    }

    /**
     * Provides access to the Serializer for this business network. The Serializer
     * is used to serialize instances of the types defined within this business network.
     * @return {Serializer} the Serializer for this business network
     */
    getSerializer() {
        return this.serializer;
    }

    /**
     * Provides access to the ScriptManager for this business network. The ScriptManager
     * manage access to the scripts that have been defined within this business network.
     * @return {ScriptManager} the ScriptManager for this business network
     * @private
     */
    getScriptManager() {
        return this.scriptManager;
    }

    /**
     * Provides access to the AclManager for this business network. The AclManager
     * manage access to the access conrol rules that have been defined for this business network.
     * @return {AclManager} the AclManager for this business network
     * @private
     */
    getAclManager() {
        return this.aclManager;
    }

    /**
     * Provides access to the ModelManager for this business network. The ModelManager
     * manage access to the models that have been defined within this business network.
     * @return {ModelManager} the ModelManager for this business network
     * @private
     */
    getModelManager() {
        return this.modelManager;
    }
}

module.exports = BusinessNetworkDefinition;
