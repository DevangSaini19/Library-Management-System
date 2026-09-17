/**
 * Aggregation stage helpers for displaying search scores in the synopsis field.
 *
 * Usage in books.ts:
 *
 *   import { searchScoreStage, vectorScoreStage, hybridScoreStage } from '../utils/score-display.js';
 *
 *   // Full-text search:   [..., searchScoreStage]
 *   // Vector search:      [..., vectorScoreStage]
 *   // Hybrid search:      [..., hybridScoreStage]  (requires scoreDetails: true)
 */

/** Prepends the $search relevance score to the synopsis. */
export const searchScoreStage = {
    $addFields: {
        synopsis: {
            $concat: [
                '[score: ', { $toString: { $round: [{ $meta: 'searchScore' }, 4] } }, ']\n',
                { $ifNull: ['$synopsis', ''] }
            ]
        }
    }
};

/** Prepends the $vectorSearch similarity score to the synopsis. */
export const vectorScoreStage = {
    $addFields: {
        synopsis: {
            $concat: [
                '[score: ', { $toString: { $round: [{ $meta: 'vectorSearchScore' }, 4] } }, ']\n',
                { $ifNull: ['$synopsis', ''] }
            ]
        }
    }
};

/**
 * Prepends the combined + per-pipeline scores to the synopsis.
 * Requires `scoreDetails: true` in the $scoreFusion or $rankFusion stage.
 */
export const hybridScoreStage = {
    $addFields: {
        synopsis: {
            $let: {
                vars: {
                    sd: { $meta: 'scoreDetails' },
                    sem: {
                        $arrayElemAt: [
                            {
                                $filter: {
                                    input: {
                                        $ifNull: [
                                            { $getField: { field: 'details', input: { $meta: 'scoreDetails' } } },
                                            []
                                        ]
                                    },
                                    cond: { $eq: ['$$this.inputPipelineName', 'semanticSearch'] }
                                }
                            },
                            0
                        ]
                    },
                    lex: {
                        $arrayElemAt: [
                            {
                                $filter: {
                                    input: {
                                        $ifNull: [
                                            { $getField: { field: 'details', input: { $meta: 'scoreDetails' } } },
                                            []
                                        ]
                                    },
                                    cond: { $eq: ['$$this.inputPipelineName', 'lexicalSearch'] }
                                }
                            },
                            0
                        ]
                    }
                },
                in: {
                    $concat: [
                        '[combined: ', { $toString: { $round: ['$$sd.value', 4] } },
                        ' | sem: ', { $toString: { $round: [{ $ifNull: ['$$sem.inputPipelineRawScore', 0] }, 4] } },
                        ' | lex: ', { $toString: { $round: [{ $ifNull: ['$$lex.inputPipelineRawScore', 0] }, 4] } },
                        ']\n',
                        { $ifNull: ['$synopsis', ''] }
                    ]
                }
            }
        }
    }
};
