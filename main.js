const fs = require('fs');
const path = require('path');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

module.exports.workspaceActions = [{
    label: 'Export as Swagger (powered by Swaggomnia 2.0.1)',
    icon: 'fa-star',
    action: async (context, models) => {

        const baseUrl = await context.app.prompt('Base Url', {
            defaultValue: localStorage.getItem('insomnia.export.openapi.base_url') || 'http://example.tld'
        })

        if (!baseUrl) return;
        localStorage.setItem('insomnia.export.openapi.base_url', baseUrl);

        const apiVersion = await context.app.prompt('API version', {
            defaultValue: localStorage.getItem('insomnia.export.openapi.api_version') || '1.0.0'
        })

        if (!apiVersion) return;
        localStorage.setItem('insomnia.export.openapi.api_version', apiVersion);

        const savePath = await context.app.showSaveDialog({
            defaultPath: localStorage.getItem('insomnia.lastExportPath') || ''
        });
        if (!savePath) return;

        localStorage.setItem('insomnia.lastExportPath', path.dirname(savePath));

        const insomniaExport = await context.data.export.insomnia({
            includePrivate: false,
            format: 'json',
            workspace: models.workspace,
        });

        const config = {
            title: models.workspace.name,
            version: apiVersion,
            basePath: baseUrl,
            description: models.workspace.description
        }

        fs.writeFileSync(savePath + '.insomnia', insomniaExport);
        fs.writeFileSync(savePath + '.config', JSON.stringify(config));

        let swaggomniaFile = '';
        switch (process.platform) {
            case 'linux':
                swaggomniaFile = __dirname + '/swaggomnia_linux_amd64/swaggomnia'
                if (!fs.existsSync(swaggomniaFile)) {
                    await exec('wget https://github.com/Fyb3roptik/swaggomnia/releases/download/2.0.1/swaggomnia_linux_amd64.tar.gz -O ' + __dirname + '/swaggomnia.tar.gz');
                    await exec('tar -xvf ' + __dirname + '/swaggomnia.tar.gz -C ' + __dirname);
                }
                console.log(swaggomniaFile + ' generate -insomnia ' + savePath + '.insomnia -config ' + savePath + '.config -output json > ' + savePath);
                await exec(swaggomniaFile + ' generate -insomnia ' + savePath + '.insomnia -config ' + savePath + '.config -output json')
                fs.renameSync(__dirname + '/swagger.json', savePath);
                break
            case 'darwin':
                swaggomniaFile = __dirname + '/swaggomnia_darwin_amd64/swaggomnia'
                if (!fs.existsSync(swaggomniaFile)) {
                    await exec('curl -o ' + __dirname + '/swaggomnia.zip https://github.com/Fyb3roptik/swaggomnia/releases/download/2.0.1/swaggomnia_darwin_amd64.zip');
                    await exec('unzip ' + __dirname + '/swaggomnia.zip -d ' + __dirname);
                }
                console.log(swaggomniaFile + ' generate -insomnia ' + savePath + '.insomnia -config ' + savePath + '.config -output json > ' + savePath);
                await exec(swaggomniaFile + ' generate -insomnia ' + savePath + '.insomnia -config ' + savePath + '.config -output json')
                fs.renameSync(__dirname + '/swagger.json', savePath);
                break
            default:
                await context.app.alert('Unsupported platform', 'Current platform "' + process.platform + '" not supported now!');
                fs.rmSync(savePath + '.insomnia');
                fs.rmSync(savePath + '.config');
                return;
        }

        fs.rmSync(savePath + '.insomnia');
        fs.rmSync(savePath + '.config');
        await context.app.alert('Result', 'Done');
    },
}];