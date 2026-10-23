import { bindHistoriographyEvents } from '../../ui/historiography-bindings.js';
import { Module, ModuleBuilder } from './Module.js';

const builder = new ModuleBuilder()
    .name('AdditionalFeatures')
    .view('assets/memory-summary/summary.html');

export default class AdditionalFeaturesModule extends Module {
    constructor() {
        super(builder);
    }

    async mount() {
        bindHistoriographyEvents();
        if (this.el) {
            this.el.id = 'amily2_additional_features_panel';
            this.el.style.display = 'none';
        }
    }
}
