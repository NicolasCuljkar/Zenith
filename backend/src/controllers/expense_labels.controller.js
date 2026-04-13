'use strict';

const labelsService = require('../services/expense_labels.service');

async function listLabels(req, res, next) {
  try {
    const { cat } = req.query;
    res.json({ success: true, data: labelsService.getAll({ userId: req.user.id, cat }) });
  } catch (err) { next(err); }
}

async function createLabel(req, res, next) {
  try {
    const { cat, name } = req.body;
    const label = labelsService.create({ cat, name }, req.user.id);
    res.status(201).json({ success: true, data: label });
  } catch (err) { next(err); }
}

async function deleteLabel(req, res, next) {
  try {
    const result = labelsService.remove(Number(req.params.id), req.user.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

module.exports = { listLabels, createLabel, deleteLabel };
