const fs = require('fs');
const path = require('path');

class OpenApiExport {
    constructor(context, models) {
        this.context = context;
        this.models = models;
    }

    async getData() {
        const insomniaExport = await this.context.data.export.insomnia({
            includePrivate: false,
            format: 'json',
            workspace: this.models.workspace,
        });

        return JSON.parse(insomniaExport);
    }

    async getServers(envs) {
        const servers = [];
        await envs.reduce(async (a, item) => {
            await a;

            try {
                const variableName = await this.context.app.prompt(
                    'Environment "' + item.name + '" please select base URL variable:',
                    {
                        submitName: 'Select (keep empty for skip)',
                        cancelable: true,
                        hints: Object.keys(item.data)
                    }
                )

                const variables = {};
                await Object.entries(item.data).reduce(async (b, dataItem) => {
                    await b;

                    variables[dataItem[0]] = {
                        default: dataItem[1] + ''
                    };
                }, Promise.resolve());

                servers.push({
                    url: item.data[variableName],
                    description: item.name,
                    variables: variables
                });
            } catch (e) {

            }
        }, Promise.resolve())

        return servers;
    }

    getTags(groups) {
        groups = groups.map((item) => {
            if (item.parentId.indexOf('wrk_') === 0) {
                item.parentId = '';
            }
            return item;
        });
        const getPaths = function (arr) {
            const map = new Map();

            arr.forEach(obj => {
                map.set(obj.id, obj);
            });

            arr.forEach(obj => {
                let path = [];
                let current = obj;

                while (current) {
                    path.unshift(current.name);
                    current = map.get(current.parentId);
                }

                obj.path = path;
            });

            return arr;
        }
        groups = getPaths(groups);

        return groups.map((group) => {
            group.path = group.path.join('/')
            return {
                name: group.path,
                description: group.description
            }
        });
    }

    getPaths(requests, groups) {
        const result = {};

        const getUrlParams = (url) => {
            const paramRegex = /{{([^{}]+)}}/g;
            const params = [];
            let match;
            while ((match = paramRegex.exec(url)) !== null) {
                params.push(match[1]);
            }
            return params;
        }

        requests.forEach((item) => {
            let url = item.url
            const params = getUrlParams(url);
            let uri = '';
            if (url.indexOf('{') === 0) {
                uri = url.replace('{{' + params[0] + '}}', '');
            } else {
                uri = url;
            }
            let replacedPathParams = Array.from(uri.matchAll(/\{{2,}\s*_\.([a-z0-9]*?)\s*}{2,}/g))
            uri = uri.replace(/\{{2,}\s*_\.([a-z0-9]*)\s*}{2,}/g, '\{$1\}');

            const method = item.method.toLowerCase();

            if (result[uri] === undefined) {
                result[uri] = {}
            }

            if (result[uri][method] === undefined) {
                result[uri][method] = {}
            }

            const requestBody = {};

            if (Object.keys(item.body).length > 0) {
                requestBody.required = true;
                switch (item.body.mimeType) {
                    case 'application/json':
                        requestBody.content = {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    example: JSON.parse(item.body.text)
                                },
                            }
                        }
                        break;
                    case 'application/x-www-form-urlencoded':
                    case 'multipart/form-data':
                        const schema = {
                            type: 'object',
                            properties: {}
                        };
                        const example = {};
                        item.body.params.forEach((param) => {
                            if (param.type === 'file') {
                                schema.properties[param.name] = {
                                    type: 'string',
                                    format: 'binary',
                                    description: param.description
                                }
                            } else {
                                schema.properties[param.name] = {
                                    type: typeof param.value,
                                    description: param.description,
                                    default: param.value
                                }
                            }
                        });
                        requestBody.content = {};
                        requestBody.content[item.body.mimeType] = {
                            schema: schema
                        }
                        break;
                }
            }

            const path = {
                description: item.description,
                summary: item.name,
                tags: [],
                parameters: [],
                responses: {
                    "200": {
                        description: 'successful'
                    },
                    "401": {
                        description: 'authorization failed'
                    },
                    "422": {
                        description: 'validation failed'
                    },
                    "500": {
                        description: 'unknown server error'
                    }
                }
            }

            if (Object.keys(requestBody).length > 0) {
                path.requestBody = requestBody;
            }

            if (item.parentId) {
                const foundedTag = groups.find(group => group.id === item.parentId);
                if (foundedTag) {
                    path.tags.push(foundedTag.path)
                }
            }

            if (replacedPathParams.length > 0) {
                replacedPathParams.forEach((replacedPathParam) => {
                    path.parameters.push({
                        name: replacedPathParam[1],
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string'
                        }
                    })
                });
            }

            if (item.parameters.length > 0) {
                item.parameters.forEach((parameter) => {
                    path.parameters.push({
                        name: parameter.name,
                        description: parameter.description,
                        in: 'query',
                        schema: {
                            type: 'string'
                        },
                        example: parameter.value
                    })
                });
            }

            switch (item.authentication?.type) {
                case 'bearer':
                    path.security = [{
                        bearerAuth: []
                    }]
                    break;
                default:
                    path.security = [];
            }

            result[uri][method] = path;
        });

        return result;
    }

}

module.exports.workspaceActions = [{
    label: 'Export as OpenAPI 3.0',
    icon: 'fa-solid fa-file-export',
    action: async (context, models) => {
        const openapi = new OpenApiExport(context, models);

        let savePath;
        try {
            const defaultPath = await context.store.getItem('last_save_path');
            savePath = await context.app.showSaveDialog({
                defaultPath: defaultPath || ''
            })
        } catch (e) {
            return;
        }
        if (!savePath) return;

        await context.store.setItem('last_save_path', path.dirname(savePath));

        const insomniaData = await openapi.getData();

        const envs = [];
        const groups = [];
        const requests = [];
        insomniaData.resources.forEach((resource) => {
            switch (resource._type) {
                case 'environment':
                    envs.push(resource);
                    break;
                case 'request_group':
                    groups.push({
                        id: resource._id,
                        parentId: resource.parentId,
                        name: resource.name,
                        description: resource.description
                    });
                    break;
                case 'request':
                    requests.push(resource);
                    break;
                default:

            }
        })

        const servers = await openapi.getServers(envs);
        if (servers.length === 0) {
            return;
        }
        const tags = openapi.getTags(groups);
        const paths = openapi.getPaths(requests, groups);

        const resultJson = {
            openapi: '3.0.3',
            info: {
                title: models.workspace.name,
                description: models.workspace.description,
                version: '1.0.0'
            },
            paths: paths,
            servers: servers,
            tags: tags,
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer'
                    }
                }
            }
        }

        fs.writeFileSync(savePath, JSON.stringify(resultJson, null, 2));

        await context.app.alert('Result', 'Done');
    },
}];