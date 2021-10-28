import { Knex, knex } from "knex"
import { Table } from "../../definitions/common"
import { Operation, QueryJson } from "../../definitions/datasource"
import { breakExternalTableId } from "../utils"
import SchemaBuilder = Knex.SchemaBuilder
import CreateTableBuilder = Knex.CreateTableBuilder
const { FieldTypes } = require("../../constants")

function generateSchema(schema: CreateTableBuilder, table: Table, tables: Record<string, Table>, oldTable: null | Table = null) {
  let primaryKey = table && table.primary ? table.primary[0] : null
  // can't change primary once its set for now
  if (primaryKey && !oldTable) {
    schema.increments(primaryKey).primary()
  }
  const foreignKeys = Object.values(table.schema).map(col => col.foreignKey)
  for (let [key, column] of Object.entries(table.schema)) {
    // skip things that are already correct
    const oldColumn = oldTable ? oldTable.schema[key] : null
    if ((oldColumn && oldColumn.type === column.type) || primaryKey === key) {
      continue
    }
    switch (column.type) {
      case FieldTypes.STRING: case FieldTypes.OPTIONS: case FieldTypes.LONGFORM:
        schema.string(key)
        break
      case FieldTypes.NUMBER:
        if (foreignKeys.indexOf(key) === -1) {
          schema.float(key)
        }
        break
      case FieldTypes.BOOLEAN:
        schema.boolean(key)
        break
      case FieldTypes.DATETIME:
        schema.datetime(key)
        break
      case FieldTypes.ARRAY:
        schema.json(key)
        break
      case FieldTypes.LINK:
        if (!column.foreignKey || !column.tableId) {
          throw "Invalid relationship schema"
        }
        const { tableName } = breakExternalTableId(column.tableId)
        // @ts-ignore
        const relatedTable = tables[tableName]
        if (!relatedTable) {
          throw "Referenced table doesn't exist"
        }
        schema.integer(column.foreignKey).unsigned()
        schema.foreign(column.foreignKey).references(`${tableName}.${relatedTable.primary[0]}`)
    }
  }
  return schema
}

function buildCreateTable(
  knex: Knex,
  table: Table,
  tables: Record<string, Table>,
): SchemaBuilder {
  return knex.schema.createTable(table.name, schema => {
    generateSchema(schema, table, tables)
  })
}

function buildUpdateTable(
  knex: Knex,
  table: Table,
  tables: Record<string, Table>,
  oldTable: Table,
): SchemaBuilder {
  return knex.schema.alterTable(table.name, schema => {
    generateSchema(schema, table, tables, oldTable)
  })
}

function buildDeleteTable(
  knex: Knex,
  table: Table,
): SchemaBuilder {
  return knex.schema.dropTable(table.name)
}

class SqlTableQueryBuilder {
  private readonly sqlClient: string

  // pass through client to get flavour of SQL
  constructor(client: string) {
    this.sqlClient = client
  }

  getSqlClient(): string {
    return this.sqlClient
  }

  /**
   * @param json the input JSON structure from which an SQL query will be built.
   * @return {string} the operation that was found in the JSON.
   */
  _operation(json: QueryJson): Operation {
    return json.endpoint.operation
  }

  _tableQuery(json: QueryJson): any {
    const client = knex({ client: this.sqlClient })
    let query
    if (!json.table || !json.meta || !json.meta.tables) {
      throw "Cannot execute without table being specified"
    }
    switch (this._operation(json)) {
      case Operation.CREATE_TABLE:
        query = buildCreateTable(client, json.table, json.meta.tables)
        break
      case Operation.UPDATE_TABLE:
        if (!json.meta || !json.meta.table) {
          throw "Must specify old table for update"
        }
        query = buildUpdateTable(client, json.table, json.meta.tables, json.meta.table)
        break
      case Operation.DELETE_TABLE:
        query = buildDeleteTable(client, json.table)
        break
      default:
        throw "Table operation is of unknown type"
    }
    return query.toSQL()
  }
}

export default SqlTableQueryBuilder
module.exports = SqlTableQueryBuilder