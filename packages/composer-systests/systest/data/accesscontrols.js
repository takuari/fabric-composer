'use strict';

/**
 * Handle the sample transaction.
 * @param {systest.accesscontrols.SampleTransaction} transaction The transaction
 * @transaction
 */
function handleSampleTransaction(transaction) {
    if (getCurrentParticipant().getFullyQualifiedIdentifier() !== 'systest.identities.SampleParticipant#bob@uk.ibm.com') {
        throw new Error('wrong participant');
    }
}
