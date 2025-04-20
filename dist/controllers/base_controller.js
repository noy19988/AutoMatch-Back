"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class BaseController {
    constructor(model) {
        this.model = model;
    }
    async getAll(req, res) {
        const ownerFilter = req.query.owner;
        try {
            if (ownerFilter) {
                const posts = await this.model.find({ owner: ownerFilter });
                res.status(200).send(posts);
            }
            else {
                const posts = await this.model.find();
                res.status(200).send(posts);
            }
        }
        catch (error) {
            res.status(400).send(error);
        }
    }
    ;
    async getById(req, res) {
        const postId = req.params.id;
        try {
            const post = await this.model.findById(postId);
            if (post === null) {
                return res.status(404).send("not found");
            }
            else {
                return res.status(200).send(post);
            }
        }
        catch (error) {
            res.status(400).send(error);
        }
    }
    ;
    async create(req, res) {
        const item = req.body;
        try {
            const newItem = await this.model.create(item);
            res.status(201).send(newItem);
        }
        catch (error) {
            res.status(400).send(error);
        }
    }
    ;
    async deleteItem(req, res) {
        const itemnId = req.params.id;
        try {
            await this.model.findByIdAndDelete(itemnId);
            res.status(200).send();
        }
        catch (error) {
            res.status(400).send(error);
        }
    }
    ;
}
;
exports.default = BaseController;
