import { createCommunicationRepository } from './repository.js';
import { createLocalCommunicationRepository } from './local-repository.js';
import { createCommunicationService } from './service.js';
import { createCommunicationDelivery } from './delivery.js';
export function createCommunicationRuntime({workRepository}={}) {
  const repository=workRepository?.inquiryTransaction?createLocalCommunicationRepository({work:workRepository}):createCommunicationRepository();
  return createCommunicationService({repository,delivery:createCommunicationDelivery()});
}
