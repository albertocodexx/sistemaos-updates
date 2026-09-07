// Fachada de compatibilidade da camada de dados.
// Os consumidores existentes continuam importando ./src/db; a implementação
// por domínios e armazenamento fica concentrada em src/database.
module.exports = require('./database/domain');
