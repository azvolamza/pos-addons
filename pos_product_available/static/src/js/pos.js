odoo.define('pos_product_available.PosModel', function(require){
"use strict";


    var models = require('point_of_sale.models');
    var Model = require('web.DataModel');

    var PosModelSuper = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        load_server_data: function(){
            var self = this;

            var loaded = PosModelSuper.load_server_data.call(this);

            var set_prod_vals = function(vals) {
                _.each(vals, function(v){
                    _.extend(self.db.get_product_by_id(v.id), v);
                });
            };

            var prod_model = _.find(this.models, function(model){
                return model.model === 'product.product';
            });
            if (prod_model) {
                prod_model.fields.push('qty_available', 'type');
                var context_super = prod_model.context;
                prod_model.context = function(that){
                    var ret = context_super(that);
                    ret.location = that.config.stock_location_id[0];
                    return ret;
                };
                var loaded_super = prod_model.loaded;
                prod_model.loaded = function(that, products){
                    loaded_super(that, products);
                    set_prod_vals(products);
                };
                return loaded;
            }

            return loaded.then(function(){
                return new Model('product.product').query(['qty_available', 'type'])
                    .filter([['sale_ok','=',true],['available_in_pos','=',true]])
                    .context({'location': self.config.stock_location_id[0]}).all().then(function(products){
                        set_prod_vals(products);
                    });
            });
        },

        set_product_qty_available: function(product, qty) {
            product.qty_available = qty;
            this.refresh_qty_available(product);
        },

        update_product_qty_from_order_lines: function(order) {
            var self = this;
            order.orderlines.each(function(line){
                var product = line.get_product();
                product.qty_available -= line.get_quantity();
                self.refresh_qty_available(product);
            });
            // compatibility with pos_multi_session
            order.trigger('new_updates_to_send');

        },

        refresh_qty_available:function(product){
            var $elem = $("[data-product-id='"+product.id+"'] .qty-tag");
            $elem.html(product.qty_available);
            if (product.qty_available <= 0 && !$elem.hasClass('not-available')){
                $elem.addClass('not-available');
            }
        },
        push_order: function(order, opts){
            var self = this;
            var pushed = PosModelSuper.push_order.call(this, order, opts);
            if (order){
                this.update_product_qty_from_order_lines(order);
            }
            return pushed;
        },
        push_and_invoice_order: function(order){
            var self = this;
            var invoiced = PosModelSuper.push_and_invoice_order.call(this, order);

            if (order && order.get_client() && order.orderlines){
                this.update_product_qty_from_order_lines(order);
            }

            return invoiced;
        },
    });

        var OrderlineSuper = models.Orderline;
    models.Orderline = models.Orderline.extend({
        export_as_JSON: function(){
            var data = OrderlineSuper.prototype.export_as_JSON.apply(this, arguments);
            data.qty_available = this.product.qty_available;
            return data;
        },
        // compatibility with pos_multi_session
        apply_ms_data: function(data) {
            if (OrderlineSuper.prototype.apply_ms_data) {
                OrderlineSuper.prototype.apply_ms_data.apply(this, arguments);
            }
            var product = this.pos.db.get_product_by_id(data.product_id);
            if (product.qty_available !== data.qty_available) {
                this.pos.set_product_qty_available(product, data.qty_available);
            }
        },

    });

});
