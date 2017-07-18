import { Store } from 'express-session';
import AWS from 'aws-sdk';
import moment from 'moment';
import {
  DEFAULT_TABLE_NAME,
  DEFAULT_RCU,
  DEFAULT_WCU,
  DEFAULT_CALLBACK,
  DEFAULT_HASH_KEY,
  DEFAULT_HASH_PREFIX,
  DEFAULT_TTL,
  API_VERSION,
} from './constants';
import { toSecondsEpoch } from './util';

export default class DynamoDBStore extends Store {
  constructor(options = {}, callback = DEFAULT_CALLBACK) {
    super();
    // table properties
    this.tableName = options.table && options.table.name ? options.table.name : DEFAULT_TABLE_NAME;
    this.hashPrefix =
      options.table && options.table.hashPrefix ? options.table.hashPrefix : DEFAULT_HASH_PREFIX;
    this.hashKey =
      options.table && options.table.hashKey ? options.table.hashKey : DEFAULT_HASH_KEY;
    this.readCapacityUnits =
      options.table && options.table.readCapacityUnits
        ? Number(options.table.readCapacityUnits)
        : DEFAULT_RCU;
    this.writeCapacityUnits =
      options.table && options.table.writeCapacityUnits
        ? Number(options.table.writeCapacityUnits)
        : DEFAULT_WCU;

    // time to live
    this.ttl = options.ttl ? options.ttl : DEFAULT_TTL;

    // AWS setup options
    const dynamoParams = options.dynamoParams ? options.dynamoParams : {};
    this.dynamoService = new AWS.DynamoDB({
      ...dynamoParams,
      apiVersion: API_VERSION,
    });
    this.documentClient = new AWS.DynamoDB.DocumentClient(null, this.dynamoService);

    // creates the table if necessary
    this.dynamoService
      .describeTable({
        TableName: this.tableName,
      })
      .promise()
      .then(() => callback())
      .catch(() => this.createTable(callback));
  }

  async createTable(callback) {
    try {
      const params = {
        TableName: this.tableName,
        KeySchema: [{ AttributeName: this.hashKey, KeyType: 'HASH' }],
        AttributeDefinitions: [{ AttributeName: this.hashKey, AttributeType: 'S' }],
        ProvisionedThroughput: {
          ReadCapacityUnits: this.readCapacityUnits,
          WriteCapacityUnits: this.writeCapacityUnits,
        },
      };
      await this.dynamoService.createTable(params).promise();
      callback();
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sess, callback) {
    try {
      const sessionId = this.getSessionId(sid);
      const expires = this.getExpirationDate(sess);
      const params = {
        TableName: this.tableName,
        Item: {
          [this.hashKey]: sessionId,
          expires: toSecondsEpoch(expires),
          sess,
        },
      };
      this.documentClient.put(params, callback);
    } catch (err) {
      callback(err);
    }
  }

  async get(sid, callback) {
    try {
      const sessionId = this.getSessionId(sid);
      const params = {
        TableName: this.tableName,
        Key: {
          [this.hashKey]: sessionId,
        },
      };
      const result = await this.documentClient.get(params).promise();
      if (
        result &&
        result.Item &&
        result.Item.expires &&
        result.Item.expires > toSecondsEpoch(new Date())
      ) {
        callback(null, result.Item.sess);
      }
      callback(null, null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      const sessionId = this.getSessionId(sid);
      const params = {
        TableName: this.tableName,
        Key: {
          [this.hashKey]: sessionId,
        },
      };
      await this.documentClient.delete(params).promise();
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async touch(sid, sess, callback) {
    try {
      const sessionId = this.getSessionId(sid);
      const expires = this.getExpirationDate(sess);
      const params = {
        TableName: this.tableName,
        Key: {
          [this.hashKey]: sessionId,
        },
        UpdateExpression: 'set expires = :e',
        ExpressionAttributeValues: {
          ':e': toSecondsEpoch(expires),
        },
        ReturnValues: 'UPDATED_NEW',
      };
      this.documentClient.update(params, callback);
    } catch (err) {
      callback(err);
    }
  }

  getSessionId(sid) {
    return `${this.hashPrefix}${sid}`;
  }

  getExpirationDate(sess) {
    let expirationDate = moment();
    if (sess.cookie && Number.isInteger(sess.cookie.maxAge)) {
      expirationDate = expirationDate.add(sess.cookie.maxAge, 'ms');
    } else {
      expirationDate = expirationDate.add(this.ttl, 'ms');
    }
    return expirationDate.toDate();
  }
}