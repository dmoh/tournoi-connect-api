import { Module } from '@nestjs/common';
import { Geocoder, GeoplateformeGeocoder } from './geocoder.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

/** Communes de France (géocodeur public de l'État, derrière l'API). */
@Module({
  controllers: [PlacesController],
  providers: [
    PlacesService,
    { provide: Geocoder, useClass: GeoplateformeGeocoder },
  ],
})
export class PlacesModule {}
