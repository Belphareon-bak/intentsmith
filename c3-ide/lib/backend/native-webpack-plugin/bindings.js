module.exports = function (jsModule) {
    switch (jsModule) {
        case 'drivelist': return require('/home/belphareon/Projects/c3-agent-wip/c3-ide/node_modules/drivelist/build/Release/drivelist.node');
    }
    throw new Error(`unhandled module: "${jsModule}"`);
}