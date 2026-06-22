// import { BoqLineItemModel } from '@coreloops-api/graphql/models/boq/boq-line-item.model';
// import { DocumentProjectModel } from '@coreloops-api/graphql/models/document/document-project.model';
// import { DocumentModel } from '@coreloops-api/graphql/models/document/document.model';
// import { EntityCostCodeModel } from '@coreloops-api/graphql/models/entity-cost-codes/entity-cost-code.model';
// import { EntityCustomTagModel } from '@coreloops-api/graphql/models/entity-custom-tag/entity-custom-tag.model';
// import { GetCostReportTableArgs } from '@coreloops-api/graphql/models/report/args/get-cost-report-table.args';
// import { GetReportMetricInput } from '@coreloops-api/graphql/models/report/inputs/get-report-metric.input';
// import { ReportMetricEnum } from '@coreloops-api/graphql/models/report/report-metric.enum';
// import { TimesheetLineItemModel } from '@coreloops-api/graphql/models/timesheet/timesheet-line-item.model';
// import { ValuationLineItemModel } from '@coreloops-api/graphql/models/valuation-line-item/valuation-line-item.model';
// import { ValuationModel } from '@coreloops-api/graphql/models/valuations/valuation.model';
// import { UserStore } from '@coreloops-api/shared/contexts';
// import { BaseRepository } from '@coreloops-orm/base/base.repository';
// import {
//   BoqDocTypeEnum,
//   boqLineItemEntity,
//   BoqLineItemTypeEnum,
// } from '@coreloops-orm/boq-line-items/boq-line-item.entity';
// import { boqEntity } from '@coreloops-orm/boqs/boq.entity';
// import { contactEntity } from '@coreloops-orm/contacts/contact.entity';
// import { costCodeEntity } from '@coreloops-orm/cost-codes/cost-code.entity';
// import { CostCodeSelectEntity } from '@coreloops-orm/cost-codes/cost-code.types';
// import { currencyRateEntity } from '@coreloops-orm/currency-rates/currency-rate.entity';
// import { customTagEntity } from '@coreloops-orm/custom-tags/custom-tag.entity';
// import { DrizzleProvider } from '@coreloops-orm/db';
// import { documentLineItemEntity } from '@coreloops-orm/document-line-items/document-line-item.entity';
// import { documentLinkEntity } from '@coreloops-orm/document-links/document-link.entity';
// import { documentProjectEntity } from '@coreloops-orm/document-projects/document-project.entity';
// import { documentEntity } from '@coreloops-orm/documents/document.entity';
// import { entityCostCodeEntity } from '@coreloops-orm/entity-cost-codes/entity-cost-code.entity';
// import { entityCustomTagEntity } from '@coreloops-orm/entity-custom-tags/entity-custom-tag.entity';
// import { projectEntity } from '@coreloops-orm/projects/project.entity';
// import { PERCENTAGE_DIVISOR } from '@coreloops-orm/report-views/report-view.constants';
// import { ReportViewTimeIncrementEnum } from '@coreloops-orm/report-views/report-view.entity';
// import { ReportViewsRepository } from '@coreloops-orm/report-views/report-view.repository';
// import { ReportViewSelectEntity } from '@coreloops-orm/report-views/report-view.types';
// import {
//   CostReportGroupingStrategyEnum,
//   ReportMetricData,
//   ReportRow,
//   ResourceReportRow,
//   TransactionReportRow,
// } from '@coreloops-orm/reports/report.types';
// import { EntityStatusEnum } from '@coreloops-orm/shared/entity.types';
// import { supplierEntity } from '@coreloops-orm/suppliers/supplier.entity';
// import { TenantRepository } from '@coreloops-orm/tenants/tenant.repository';
// import {
//   timesheetLineItemEntity,
//   TimesheetLineItemScaffoldType,
// } from '@coreloops-orm/timesheet-line-items/timesheet-line-item.entity';
// import { timesheetProjectEntity } from '@coreloops-orm/timesheet-projects/timesheet-project.entity';
// import { timesheetEntity } from '@coreloops-orm/timesheets/timesheet.entity';
// import { valuationLineItemEntity } from '@coreloops-orm/valuation-line-items/valuation-line-item.entity';
// import { PublicationStatusEnum, valuationEntity } from '@coreloops-orm/valuations/valuation.entity';
// import { roundTo, roundTo2dp } from '@coreloops-shared/utils/number-utils';
// import { DocumentTypeEnum, EntityTypeEnum, getCostReportMetricLabel, MetricKey } from '@coreloops/shared-types';
// import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
// import { Filter } from '@ptc-org/nestjs-query-core';
// import { aliasedTable, and, AnyColumn, eq, or, type SQL, sql, sum } from 'drizzle-orm';
// import { PgTable, QueryBuilder } from 'drizzle-orm/pg-core';
// import { ClsService } from 'nestjs-cls';

// export type MissingDocumentCurrencyRate = {
//   currencyCode: string;
//   documentCount: number;
// };

// /** Map a ReportRow so all numeric fields are rounded to 2dp (floating-point safe). */
// function roundReportRowTo2dp(row: ReportRow): ReportRow {
//   return {
//     ...row,
//     projectStartDate: row.projectStartDate,
//     projectTargetDate: row.projectTargetDate,
//     totalWeeks: roundTo2dp(row.totalWeeks),
//     weeksElapsed: roundTo2dp(row.weeksElapsed),
//     timeProgressPct: roundTo(row.timeProgressPct, 4),
//     contractValue: roundTo2dp(row.contractValue),
//     contractBudget: roundTo2dp(row.contractBudget),
//     actualCosts: roundTo2dp(row.actualCosts),
//     actualSales: roundTo2dp(row.actualSales),
//     appliedValue: roundTo2dp(row.appliedValue),
//     appliedBudget: roundTo2dp(row.appliedBudget),
//     originalValue: roundTo2dp(row.originalValue),
//     originalBudget: roundTo2dp(row.originalBudget),
//     originalMargin: roundTo2dp(row.originalMargin),
//     originalMarginPct: roundTo(row.originalMarginPct, 4),
//     periodApplied: roundTo2dp(row.periodApplied),
//     certifiedValue: roundTo2dp(row.certifiedValue),
//     certifiedBudget: roundTo2dp(row.certifiedBudget),
//     periodCertified: roundTo2dp(row.periodCertified),
//     contractMargin: roundTo2dp(row.contractMargin),
//     contractMarginPct: roundTo(row.contractMarginPct, 4),
//     appliedMargin: roundTo2dp(row.appliedMargin),
//     appliedMarginPct: roundTo(row.appliedMarginPct, 4),
//     certifiedMargin: roundTo2dp(row.certifiedMargin),
//     certifiedMarginPct: roundTo(row.certifiedMarginPct, 4),
//     actualsMinusAppliedBudget: roundTo2dp(row.actualsMinusAppliedBudget),
//     actualsMinusAppliedBudgetPct: roundTo(row.actualsMinusAppliedBudgetPct, 4),
//     actualsMinusCertifiedBudget: roundTo2dp(row.actualsMinusCertifiedBudget),
//     actualsMinusCertifiedBudgetPct: roundTo(row.actualsMinusCertifiedBudgetPct, 4),
//     contractBudgetUtilisationPct: roundTo(row.contractBudgetUtilisationPct, 4),
//     appliedValueMinusActualCosts: roundTo2dp(row.appliedValueMinusActualCosts),
//     appliedValueMinusActualCostsPct: roundTo(row.appliedValueMinusActualCostsPct, 4),
//     certifiedValueMinusActualCosts: roundTo2dp(row.certifiedValueMinusActualCosts),
//     certifiedValueMinusActualCostsPct: roundTo(row.certifiedValueMinusActualCostsPct, 4),
//     actualCostsMinusAppliedBudget: roundTo2dp(row.actualCostsMinusAppliedBudget),
//     appliedBudgetMinusActualCostsPct: roundTo(row.appliedBudgetMinusActualCostsPct, 4),
//     actualCostsMinusCertifiedBudget: roundTo2dp(row.actualCostsMinusCertifiedBudget),
//     appliedBudgetUtilisationPct: roundTo(row.appliedBudgetUtilisationPct, 4),
//     certifiedBudgetUtilisationPct: roundTo(row.certifiedBudgetUtilisationPct, 4),
//     periodAppliedMinusActualCosts: roundTo2dp(row.periodAppliedMinusActualCosts),
//     periodAppliedMinusActualCostsPct: roundTo(row.periodAppliedMinusActualCostsPct, 4),
//     periodCertifiedMinusActualCosts: roundTo2dp(row.periodCertifiedMinusActualCosts),
//     periodCertifiedMinusActualCostsPct: roundTo(row.periodCertifiedMinusActualCostsPct, 4),
//     actualSalesMinusActualCosts: roundTo2dp(row.actualSalesMinusActualCosts),
//     actualSalesMinusActualCostsPct: roundTo(row.actualSalesMinusActualCostsPct, 4),
//     periodActualCostsSubtotal: roundTo2dp(row.periodActualCostsSubtotal),
//     cumulativeActualCostsSubtotal: roundTo2dp(row.cumulativeActualCostsSubtotal),
//     budgetUtilisationPct: roundTo(row.budgetUtilisationPct, 4),
//     cumulativeBudgetUtilisationPct: roundTo(row.cumulativeBudgetUtilisationPct, 4),
//     totalValuationAppliedCumulative: roundTo2dp(row.totalValuationAppliedCumulative),
//     totalBudgetAppliedCumulative: roundTo2dp(row.totalBudgetAppliedCumulative),
//     totalValuationCertifiedCumulative: roundTo2dp(row.totalValuationCertifiedCumulative),
//     totalBudgetCertifiedCumulative: roundTo2dp(row.totalBudgetCertifiedCumulative),
//     periodAppliedActualMargin: roundTo2dp(row.periodAppliedActualMargin),
//     periodCertifiedActualMargin: roundTo2dp(row.periodCertifiedActualMargin),
//     actualMargin: roundTo2dp(row.actualMargin),
//     periodAppliedActualMarginPct: roundTo(row.periodAppliedActualMarginPct, 4),
//     periodCertifiedActualMarginPct: roundTo(row.periodCertifiedActualMarginPct, 4),
//     actualMarginPct: roundTo(row.actualMarginPct, 4),
//     cumulativeAppliedActualMargin: roundTo2dp(row.cumulativeAppliedActualMargin),
//     cumulativeCertifiedActualMargin: roundTo2dp(row.cumulativeCertifiedActualMargin),
//     cumulativeAppliedActualMarginPct: roundTo(row.cumulativeAppliedActualMarginPct, 4),
//     cumulativeCertifiedActualMarginPct: roundTo(row.cumulativeCertifiedActualMarginPct, 4),
//     periodAppliedVsCertifiedGap: roundTo2dp(row.periodAppliedVsCertifiedGap),
//     periodAppliedVsCertifiedGapPct: roundTo(row.periodAppliedVsCertifiedGapPct, 4),
//     cumulativeAppliedVsCertifiedGap: roundTo2dp(row.cumulativeAppliedVsCertifiedGap),
//     cumulativeAppliedVsCertifiedGapPct: roundTo(row.cumulativeAppliedVsCertifiedGapPct, 4),
//     netForecastValue: roundTo2dp(row.netForecastValue),
//     netForecastBudget: roundTo2dp(row.netForecastBudget),
//     totalRetentionApplied: roundTo2dp(row.totalRetentionApplied),
//     totalRetentionCertified: roundTo2dp(row.totalRetentionCertified),
//     netValuationApplied: roundTo2dp(row.netValuationApplied),
//     netValuationCertified: roundTo2dp(row.netValuationCertified),
//     previouslyApplied: roundTo2dp(row.previouslyApplied),
//     previouslyCertified: roundTo2dp(row.previouslyCertified),
//     paymentApplicationNumber: row.paymentApplicationNumber,
//     periodAppliedBudget: roundTo2dp(row.periodAppliedBudget),
//     periodCertifiedBudget: roundTo2dp(row.periodCertifiedBudget),
//     periodRetentionApplied: roundTo2dp(row.periodRetentionApplied),
//     periodRetentionCertified: roundTo2dp(row.periodRetentionCertified),
//     grossPaymentDueApplied: roundTo2dp(row.grossPaymentDueApplied),
//     grossPaymentDueCertified: roundTo2dp(row.grossPaymentDueCertified),
//     vatApplied: roundTo2dp(row.vatApplied),
//     vatCertified: roundTo2dp(row.vatCertified),
//     netPaymentDueApplied: roundTo2dp(row.netPaymentDueApplied),
//     netPaymentDueCertified: roundTo2dp(row.netPaymentDueCertified),
//   };
// }

// /** Map a TransactionReportRow so all financial fields are rounded to 2dp. */
// function roundTransactionReportRowTo2dp(row: TransactionReportRow): TransactionReportRow {
//   return {
//     ...row,
//     documentSubtotal: roundTo2dp(row.documentSubtotal),
//     paidAmount: roundTo2dp(row.paidAmount),
//     outstandingAmount: roundTo2dp(row.outstandingAmount),
//     totalAmount: roundTo2dp(row.totalAmount),
//   };
// }

// @Injectable()
// export class ReportsRepository extends BaseRepository {
//   protected readonly logger = new Logger(ReportsRepository.name);
//   readonly table: PgTable = boqEntity as PgTable; // Dummy table for base class
//   readonly relationMap = undefined;
//   readonly defaultDocumentStatuses = [EntityStatusEnum.APPROVED, EntityStatusEnum.PAID];
//   private readonly reportViewsRepository: ReportViewsRepository;

//   private buildScopedFilter<TField extends 'projectId' | 'id'>(
//     field: TField,
//     projectId: string | undefined,
//     projects: string[],
//   ): Partial<Record<TField, { eq: string } | { in: string[] }>> {
//     if (projectId) {
//       return { [field]: { eq: projectId } } as Partial<Record<TField, { eq: string } | { in: string[] }>>;
//     }

//     if (projects.length > 0) {
//       return { [field]: { in: projects } } as Partial<Record<TField, { eq: string } | { in: string[] }>>;
//     }

//     return {};
//   }

//   constructor(
//     protected readonly cls: ClsService<UserStore>,
//     protected readonly drizzle: DrizzleProvider,
//     protected readonly tenantRepository: TenantRepository,
//     @Inject(forwardRef(() => ReportViewsRepository)) reportViewsRepository: unknown,
//   ) {
//     super(cls, drizzle);
//     this.reportViewsRepository = reportViewsRepository as ReportViewsRepository;
//   }

//   async getAllCustomTags(): Promise<Array<{ id: string; title: string }>> {
//     return this.drizzle.db
//       .select({
//         id: customTagEntity.id,
//         title: customTagEntity.title,
//       })
//       .from(customTagEntity)
//       .where(
//         this.mapFilterToQuery({
//           filter: this.withTenant({}),
//           table: customTagEntity,
//         }),
//       )
//       .orderBy(customTagEntity.title);
//   }

//   async findMissingDocumentCurrencyRates(): Promise<MissingDocumentCurrencyRate[]> {
//     const db = this.drizzle.db;
//     const tenantId = this.tenantId;

//     const tenant = await this.tenantRepository.getTenantById(tenantId);
//     const tenantCurrencyCode = tenant?.currency;

//     const documentCurrencyRows = await db
//       .select({
//         currencyCode: documentEntity.currency,
//         documentCount: sql<number>`count(distinct ${documentEntity.id})`.mapWith(Number),
//       })
//       .from(documentEntity)
//       .where(
//         and(
//           this.mapFilterToQuery({
//             filter: this.withTenant<DocumentModel>({
//               currency: { isNot: null },
//               status: { neq: EntityStatusEnum.HIDDEN },
//             }),
//             table: documentEntity,
//           }),
//           tenantCurrencyCode ? sql`${documentEntity.currency} <> ${tenantCurrencyCode}` : undefined,
//         ),
//       )
//       .groupBy(documentEntity.currency)
//       .orderBy(documentEntity.currency);

//     const rateRows = await db
//       .select({
//         targetCurrency: currencyRateEntity.targetCurrency,
//       })
//       .from(currencyRateEntity)
//       .where(
//         this.mapFilterToQuery({
//           filter: this.withTenant({}),
//           table: currencyRateEntity,
//         }),
//       );

//     const availableCurrencies = new Set(rateRows.map(row => row.targetCurrency));

//     return documentCurrencyRows
//       .filter((row): row is typeof row & { currencyCode: string } => row.currencyCode != null)
//       .filter(row => !availableCurrencies.has(row.currencyCode))
//       .map(row => ({
//         currencyCode: row.currencyCode,
//         documentCount: row.documentCount,
//       }));
//   }

//   async getReportView(id: string): Promise<ReportViewSelectEntity | undefined> {
//     return this.reportViewsRepository.findReportView({
//       id: { eq: id },
//     });
//   }

//   /**
//   /*
//    * Retrieves report metric data for a specified source type and source identifier.
//    *
//    * @param {ReportMetricEnum} metric - The metric to be retrieved.
//    * @param {string} sourceId - The unique identifier of the source entity.
//    * @param {EntityTypeEnum} sourceType - The type of the source entity (e.g., PROJECT, BOQ, VALUATION, DOCUMENT).
//    * @return {Promise<ReportMetricData | null>} A promise that resolves to the requested metric data, or null if the source type is unsupported.
//    */
//   async getReportMetricData({
//     metric,
//     sourceId,
//     sourceType,
//     projectId,
//     dateFrom,
//     dateTo,
//     reportViewId,
//   }: GetReportMetricInput): Promise<ReportMetricData | null> {
//     const reportView = await this.getReportView(reportViewId);

//     switch (sourceType) {
//       case EntityTypeEnum.PROJECT:
//         return this.getProjectMetric(metric, sourceId, dateFrom, dateTo, reportView);

//       case EntityTypeEnum.VALUATION:
//         return this.getValuationMetric(metric, sourceId, projectId, dateFrom, dateTo, reportView);

//       case EntityTypeEnum.DOCUMENT:
//         return this.getDocumentMetric(metric, sourceId, dateFrom, dateTo, reportView);

//       default:
//         this.logger.warn(`Unsupported source type: ${sourceType}`);
//         return null;
//     }
//   }

//   /**
//    * Retrieves all cost codes associated with a specific project.
//    * This includes cost codes assigned to BOQ line items and entity cost codes (documents, timesheets).
//    *
//    * @param {string} projectId - The unique identifier of the project.
//    * @return {Promise<CostCodeSelectEntity[]>} A promise resolving to a list of cost code entities.
//    */
//   async getProjectCostCodes(projectId: string): Promise<CostCodeSelectEntity[]> {
//     const db = this.drizzle.db;

//     // Get cost codes used in entity_cost_codes (documents, timesheets, boq) for the project
//     const entityCostCodesCte = db.$with('entity_cc').as(
//       db
//         .select({ costCodeId: entityCostCodeEntity.costCodeId })
//         .from(entityCostCodeEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCostCodeModel>({
//               and: [{ projectId: { eq: projectId } }, { costCodeId: { isNot: null } }],
//             }),
//             table: entityCostCodeEntity,
//           }),
//         )
//         .groupBy(entityCostCodeEntity.costCodeId),
//     );

//     const rows = await db
//       .with(entityCostCodesCte)
//       .select({
//         costCode: costCodeEntity,
//       })
//       .from(entityCostCodesCte)
//       .innerJoin(costCodeEntity, eq(costCodeEntity.id, entityCostCodesCte.costCodeId));

//     return rows.map(r => r.costCode);
//   }

//   /**
//    * Retrieves the available metrics based on the specified source type.
//    *
//    * @param {EntityTypeEnum} sourceType - The type of entity to retrieve metrics for, such as PROJECT, BOQ, VALUATION, or DOCUMENT.
//    * @return {ReportMetricEnum[]} An array of metrics available for the given source type. Returns an empty array if no metrics are available for the specified type.
//    */
//   getAvailableMetrics(sourceType: EntityTypeEnum): ReportMetricEnum[] {
//     switch (sourceType) {
//       case EntityTypeEnum.PROJECT:
//         return [
//           ReportMetricEnum.CONTRACT_VALUE,
//           ReportMetricEnum.CONTRACT_BUDGET,
//           ReportMetricEnum.CONTRACT_MARGIN,
//           ReportMetricEnum.CONTRACT_MARGIN_PERCENT,
//         ];
//       case EntityTypeEnum.BOQ:
//         return [
//           ReportMetricEnum.CONTRACT_VALUE,
//           ReportMetricEnum.CONTRACT_BUDGET,
//           ReportMetricEnum.CONTRACT_MARGIN,
//           ReportMetricEnum.CONTRACT_MARGIN_PERCENT,
//         ];

//       case EntityTypeEnum.VALUATION:
//         return [
//           ReportMetricEnum.CERTIFIED_VALUE,
//           ReportMetricEnum.CERTIFIED_BUDGET,
//           ReportMetricEnum.APPLIED_VALUE,
//           ReportMetricEnum.APPLIED_BUDGET,
//         ];

//       case EntityTypeEnum.DOCUMENT:
//         return [
//           ReportMetricEnum.ACTUAL_SALES,
//           ReportMetricEnum.ACTUAL_COST,
//           ReportMetricEnum.SALES_INVOICES,
//           ReportMetricEnum.PURCHASE_ORDERS,
//           ReportMetricEnum.ACTUAL_COSTS,
//           ReportMetricEnum.PAID_COSTS,
//         ];

//       default:
//         return [];
//     }
//   }

//   /**
//    * Retrieves a specific metric related to a project's financial data.
//    *
//    * @param {ReportMetricEnum} metric - The type of metric to be retrieved. This could represent contract value, budget, margin, or margin percentage.
//    * @param {string} projectId - The unique identifier of the project for which the metric is requested.
//    * @return {Promise<ReportMetricData | null>} A promise that resolves to an object containing the requested metric's value, or null if unavailable.
//    */
//   private async getProjectMetric(
//     metric: ReportMetricEnum,
//     projectId: string | undefined,
//     _dateFrom: string,
//     _dateTo: string,
//     reportView?: ReportViewSelectEntity,
//   ): Promise<ReportMetricData | null> {
//     const db = this.drizzle.db;
//     const projectsForReport = reportView ? this.getProjectsForReport(reportView) : [];

//     // Fetch current forecast values (sum of all BOQ line items)
//     const andFilters: Filter<BoqLineItemModel>[] = [
//       { type: { eq: BoqLineItemTypeEnum.LINE_ITEM } },
//       { boqDocType: { eq: BoqDocTypeEnum.BOQ } },
//     ];

//     if (projectId) {
//       andFilters.push({
//         projectId: { eq: projectId },
//       });
//     } else if (projectsForReport.length > 0) {
//       andFilters.push({
//         projectId: { in: projectsForReport },
//       });
//     }
//     const rows = await db
//       .select({
//         valueTotal: sum(sql`${boqLineItemEntity.sellPrice}`).mapWith(Number),
//         budgetTotal: sum(sql`${boqLineItemEntity.costPrice}`).mapWith(Number),
//       })
//       .from(boqLineItemEntity)
//       .where(
//         this.mapFilterToQuery({
//           filter: this.withTenant<BoqLineItemModel>({
//             and: andFilters,
//           }),
//           table: boqLineItemEntity,
//         }),
//       );

//     const totals = rows[0] || { valueTotal: 0, budgetTotal: 0 };
//     const contractValue = totals.valueTotal || 0;
//     const contractBudget = totals.budgetTotal || 0;
//     const contractMargin = contractValue - contractBudget;
//     const contractMarginPercent = contractValue > 0 ? (contractMargin / contractValue) * PERCENTAGE_DIVISOR : 0;

//     // Fetch original values (tenderValue and tenderBudget) from project entity
//     const projectFilter = this.buildScopedFilter('id', projectId, projectsForReport);
//     const projects = await db
//       .select({
//         tenderValue: projectEntity.tenderValue,
//         tenderBudget: projectEntity.tenderBudget,
//       })
//       .from(projectEntity)
//       .where(
//         this.mapFilterToQuery({
//           filter: this.withTenant(projectFilter),
//           table: projectEntity,
//         }),
//       );

//     // Sum tender values across all matched projects
//     const totalTenderValue = projects.reduce((sum, p) => sum + (p.tenderValue ?? 0), 0) || undefined;
//     const totalTenderBudget = projects.reduce((sum, p) => sum + (p.tenderBudget ?? 0), 0) || undefined;
//     const originalValue = totalTenderValue;
//     const originalBudget = totalTenderBudget;
//     const originalMargin =
//       originalValue !== undefined && originalBudget !== undefined ? originalValue - originalBudget : undefined;

//     switch (metric) {
//       case ReportMetricEnum.CONTRACT_VALUE:
//         return {
//           value: contractValue,
//           secondaryValue: originalValue,
//           secondaryLabel: getCostReportMetricLabel(MetricKey.OriginalValue),
//         };
//       case ReportMetricEnum.CONTRACT_BUDGET:
//         return {
//           value: contractBudget,
//           secondaryValue: originalBudget,
//           secondaryLabel: getCostReportMetricLabel(MetricKey.OriginalBudget),
//         };
//       case ReportMetricEnum.CONTRACT_MARGIN:
//         return {
//           value: contractMargin,
//           secondaryValue: originalMargin,
//           secondaryLabel: getCostReportMetricLabel(MetricKey.OriginalMargin),
//         };
//       case ReportMetricEnum.CONTRACT_MARGIN_PERCENT: {
//         const originalMarginPercent =
//           originalValue !== undefined && originalValue > 0 && originalMargin !== undefined
//             ? (originalMargin / originalValue) * PERCENTAGE_DIVISOR
//             : undefined;
//         return {
//           value: contractMarginPercent,
//           secondaryValue: originalMarginPercent,
//           secondaryLabel: getCostReportMetricLabel(MetricKey.OriginalMarginPct),
//         };
//       }
//       default:
//         return { value: 0 };
//     }
//   }

//   /**
//    * Retrieves the valuation metric based on the specified metric type and optional valuation identifier.
//    *
//    * @param {ReportMetricEnum} metric - The type of metric to retrieve (e.g. certified value, applied budget).
//    * @param {string} [valuationId] - The optional valuation identifier used to filter the data.
//    * @param {string} projectId - The project ID to ensure project scoping of BOQ line items.
//    * @return {Promise<ReportMetricData | null>} A promise that resolves to an object containing the requested metric value or `null` if no data is found.
//    */
//   private async getValuationMetric(
//     metric: ReportMetricEnum,
//     valuationId?: string,
//     projectId?: string,
//     dateFrom?: string,
//     dateTo?: string,
//     reportView?: ReportViewSelectEntity,
//   ): Promise<ReportMetricData | null> {
//     const db = this.drizzle.db;
//     const usePeriodAggregation = !valuationId;
//     const projectsForReport = reportView ? this.getProjectsForReport(reportView) : [];

//     const valuationLineItemFilters: Filter<ValuationLineItemModel>[] = [
//       { type: { eq: BoqLineItemTypeEnum.LINE_ITEM } },
//     ];

//     if (valuationId) {
//       valuationLineItemFilters.push({ valuationId: { eq: valuationId } });
//     }

//     const certifiedValueExpr = usePeriodAggregation
//       ? sql`${valuationLineItemEntity.periodCertifiedAmount}`
//       : sql`${valuationLineItemEntity.certifiedAmount}`;
//     const certifiedBudgetExpr = usePeriodAggregation
//       ? sql`${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.periodCertifiedPercentage} / ${PERCENTAGE_DIVISOR})`
//       : sql`${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.certifiedPercent} / ${PERCENTAGE_DIVISOR})`;
//     const appliedValueExpr = usePeriodAggregation
//       ? sql`${valuationLineItemEntity.periodAppliedAmount}`
//       : sql`${boqLineItemEntity.sellPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})`;
//     const appliedBudgetExpr = usePeriodAggregation
//       ? sql`${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.periodAppliedPercentage} / ${PERCENTAGE_DIVISOR})`
//       : sql`${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})`;

//     const boqProjectFilter = this.buildScopedFilter('projectId', projectId, projectsForReport);

//     const rows = await db
//       .select({
//         certifiedValue: sum(certifiedValueExpr).mapWith(Number),
//         certifiedBudget: sum(certifiedBudgetExpr).mapWith(Number),
//         appliedValue: sum(appliedValueExpr).mapWith(Number),
//         appliedBudget: sum(appliedBudgetExpr).mapWith(Number),
//       })
//       .from(valuationLineItemEntity)
//       .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id))
//       .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//       .where(
//         and(
//           this.mapFilterToQuery({
//             filter: this.withTenant<ValuationLineItemModel>({
//               and: valuationLineItemFilters,
//             }),
//             table: valuationLineItemEntity,
//           }),
//           this.mapFilterToQuery({
//             filter: this.withTenant<BoqLineItemModel>(boqProjectFilter),
//             table: boqLineItemEntity,
//           }),
//           this.mapFilterToQuery({
//             filter: this.withTenant<ValuationModel>({
//               and: [
//                 { publicationStatus: { eq: PublicationStatusEnum.PUBLISHED } },
//                 ...(dateFrom ? [{ date: { gte: dateFrom } }] : []),
//                 ...(dateTo ? [{ date: { lte: dateTo } }] : []),
//               ],
//             }),
//             table: valuationEntity,
//           }),
//         ),
//       );

//     const row = rows[0] || {};
//     switch (metric) {
//       case ReportMetricEnum.CERTIFIED_VALUE:
//         return { value: row.certifiedValue || 0 };
//       case ReportMetricEnum.CERTIFIED_BUDGET:
//         return { value: row.certifiedBudget || 0 };
//       case ReportMetricEnum.APPLIED_VALUE:
//         return { value: row.appliedValue || 0 };
//       case ReportMetricEnum.APPLIED_BUDGET:
//         return { value: row.appliedBudget || 0 };
//       default:
//         return { value: 0 };
//     }
//   }

//   /** Resolve the tenant's default (base) currency code, or undefined when none is configured. */
//   private async getTenantCurrencyCode(): Promise<string | undefined> {
//     const tenant = await this.tenantRepository.getTenantById(this.tenantId);
//     return tenant?.currency ?? undefined;
//   }

//   /**
//    * Wraps a document line-item monetary expression so that, when the owning document is not in the
//    * tenant's default currency, it is converted to that default currency on the fly using the tenant's
//    * configured currency rate. Conversion follows the same direction used elsewhere in the app
//    * (foreign -> base = amount / rate).
//    *
//    * Falls back to the raw amount when: no tenant currency is configured, the document already uses the
//    * tenant currency, or no usable rate exists for the document currency (missing rates are surfaced
//    * separately via {@link findMissingDocumentCurrencyRates}).
//    *
//    * Requires `documentEntity` to be in scope (joined) in the surrounding query so the correlated
//    * rate lookup can reference the document's currency and tenant.
//    */
//   private convertDocumentAmountExpr(amountExpr: SQL, tenantCurrencyCode: string | undefined): SQL {
//     if (!tenantCurrencyCode) {
//       return amountExpr;
//     }

//     return sql`(
//       (${amountExpr})
//       / coalesce(
//           nullif(
//             case
//               when ${documentEntity.currency} is null or ${documentEntity.currency} = ${tenantCurrencyCode}
//                 then 1
//               else (
//                 select ${currencyRateEntity.rate}
//                 from ${currencyRateEntity}
//                 where ${currencyRateEntity.targetCurrency} = ${documentEntity.currency}
//                   and ${currencyRateEntity.tenantId} = ${documentEntity.tenantId}
//                 limit 1
//               )
//             end,
//             0
//           ),
//           1
//         )
//     )`;
//   }

//   private async getProjectActualCostTotal(
//     projectId: string | undefined,
//     dateFrom: string,
//     dateTo: string,
//     reportView: ReportViewSelectEntity | undefined,
//   ): Promise<ReportMetricData> {
//     const db = this.drizzle.db;
//     const tenantCurrencyCode = await this.getTenantCurrencyCode();
//     const projectsForReport = reportView ? this.getProjectsForReport(reportView) : [];
//     const hasProjectFilter = Boolean(projectId) || projectsForReport.length > 0;
//     const projectFilterObj = this.buildScopedFilter('projectId', projectId, projectsForReport);

//     const suppliers = this.getSuppliersForReport(reportView);
//     const costCodeFilter = this.getDocumentCostCodeFilter(this.getCostCodesForReport(reportView));

//     let documentCostQuery = db
//       .select({
//         total: sum(
//           this.convertDocumentAmountExpr(
//             sql`
//           case
//             when ${documentEntity.documentType} in (${sql.join(
//               [DocumentTypeEnum.INVOICE, DocumentTypeEnum.RECEIPT, DocumentTypeEnum.ACCRUAL],
//               sql`,`,
//             )})
//               then ${documentLineItemEntity.subtotal}
//             when ${documentEntity.documentType} = ${DocumentTypeEnum.CREDIT_NOTE}
//               then -${documentLineItemEntity.subtotal}
//             else 0
//           end
//         `,
//             tenantCurrencyCode,
//           ),
//         ).mapWith(Number),
//       })
//       .from(documentEntity)
//       .leftJoin(supplierEntity, eq(supplierEntity.id, documentEntity.supplierId))
//       .innerJoin(documentLineItemEntity, eq(documentLineItemEntity.documentId, documentEntity.id));

//     if (hasProjectFilter) {
//       documentCostQuery = documentCostQuery.innerJoin(
//         documentProjectEntity,
//         eq(documentProjectEntity.documentId, documentEntity.id),
//       );
//     }

//     const filters: Filter<DocumentModel>[] = [
//       { status: { in: this.getDocumentStatusesForReport(reportView) } },
//       { issueDate: { gte: dateFrom } },
//       { issueDate: { lte: dateTo } },
//     ];

//     if (suppliers.length > 0) {
//       filters.push({ supplierId: { in: suppliers } });
//     }

//     const [result] = await documentCostQuery.where(
//       and(
//         this.mapFilterToQuery({
//           filter: this.withTenant<DocumentModel>({
//             and: filters,
//           }),
//           table: documentEntity,
//         }),
//         costCodeFilter,
//         sql`coalesce(${supplierEntity.excludeFromReports}, false) = false`,
//         hasProjectFilter
//           ? this.mapFilterToQuery({
//               filter: this.withTenant<DocumentProjectModel>(projectFilterObj),
//               table: documentProjectEntity,
//             })
//           : undefined,
//       ),
//     );

//     let timesheetCostQuery = db
//       .select({
//         total: sql<number>`
//             sum(
//               ${timesheetLineItemEntity.subtotal}
//             )
//           `.as('value'),
//       })
//       .from(timesheetLineItemEntity)
//       .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id));

//     if (hasProjectFilter) {
//       timesheetCostQuery = timesheetCostQuery.innerJoin(
//         timesheetProjectEntity,
//         eq(timesheetProjectEntity.timesheetId, timesheetEntity.id),
//       );
//     }

//     const [timesheetResult] = await timesheetCostQuery.where(
//       and(
//         this.mapFilterToQuery({
//           filter: this.withTenant({
//             status: { eq: EntityStatusEnum.APPROVED },
//             startOfWeek: { gte: dateFrom, lte: dateTo },
//           }),
//           table: timesheetEntity,
//         }),
//         hasProjectFilter
//           ? this.mapFilterToQuery({
//               filter: this.withTenant(projectFilterObj),
//               table: timesheetProjectEntity,
//             })
//           : undefined,
//         this.mapFilterToQuery({
//           filter: this.withTenant<TimesheetLineItemModel>({
//             and: [{ date: { isNot: null } }, ...(hasProjectFilter ? [projectFilterObj] : [])],
//           }),
//           table: timesheetLineItemEntity,
//         }),
//       ),
//     );

//     return {
//       value: (result?.total || 0) + (timesheetResult?.total || 0),
//     };
//   }

//   getDocumentStatusesForReport(
//     reportView: ReportViewSelectEntity | undefined,
//     defaultStatuses = this.defaultDocumentStatuses,
//   ): EntityStatusEnum[] {
//     return reportView?.documentStatuses?.length ? reportView.documentStatuses : defaultStatuses;
//   }

//   getSuppliersForReport(reportView: ReportViewSelectEntity | undefined): string[] {
//     return reportView?.suppliers?.length ? reportView.suppliers : [];
//   }

//   getCostCodesForReport(reportView: ReportViewSelectEntity | undefined): string[] {
//     return reportView?.costCodes?.length ? reportView.costCodes : [];
//   }

//   private getDocumentCostCodeFilter(costCodes: string[]): SQL | undefined {
//     if (costCodes.length === 0) {
//       return undefined;
//     }

//     return sql`
//       exists (
//         select 1
//         from ${entityCostCodeEntity} ecc
//         where ecc.document_line_item_id = ${documentLineItemEntity.id}
//           and ecc.tenant_id = ${this.tenantId}
//           and ecc.cost_code_id in (${sql.join(
//             costCodes.map(costCodeId => sql`${costCodeId}`),
//             sql`,`,
//           )})
//       )
//     `;
//   }

//   getProjectsForReport(reportView: ReportViewSelectEntity | undefined): string[] {
//     return reportView?.projects?.length ? reportView.projects : [];
//   }

//   private async getProjectActualSalesTotal(
//     projectId: string | undefined,
//     dateFrom: string,
//     dateTo: string,
//     reportView: ReportViewSelectEntity | undefined,
//   ): Promise<ReportMetricData> {
//     const db = this.drizzle.db;
//     const tenantCurrencyCode = await this.getTenantCurrencyCode();
//     const projectsForReport = reportView ? this.getProjectsForReport(reportView) : [];
//     const hasProjectFilter = Boolean(projectId) || projectsForReport.length > 0;
//     const projectFilterObj = this.buildScopedFilter('projectId', projectId, projectsForReport);

//     let documentSalesQuery = db
//       .select({
//         total: sum(
//           this.convertDocumentAmountExpr(
//             sql`
//           case
//             when ${documentEntity.documentType} in (${sql.join([DocumentTypeEnum.SALES_INVOICE], sql`,`)})
//               then ${documentLineItemEntity.subtotal}
//             when ${documentEntity.documentType} = ${DocumentTypeEnum.SALES_CREDIT_NOTE}
//               then -${documentLineItemEntity.subtotal}
//             else 0
//           end
//         `,
//             tenantCurrencyCode,
//           ),
//         ).mapWith(Number),
//       })
//       .from(documentEntity)
//       .innerJoin(documentLineItemEntity, eq(documentLineItemEntity.documentId, documentEntity.id));

//     if (hasProjectFilter) {
//       documentSalesQuery = documentSalesQuery.innerJoin(
//         documentProjectEntity,
//         eq(documentProjectEntity.documentId, documentEntity.id),
//       );
//     }

//     const suppliers = this.getSuppliersForReport(reportView);
//     const costCodeFilter = this.getDocumentCostCodeFilter(this.getCostCodesForReport(reportView));

//     const filters: Filter<DocumentModel>[] = [
//       { status: { in: this.getDocumentStatusesForReport(reportView) } },
//       { issueDate: { gte: dateFrom } },
//       { issueDate: { lte: dateTo } },
//     ];

//     if (suppliers.length > 0) {
//       filters.push({ supplierId: { in: suppliers } });
//     }

//     const [result] = await documentSalesQuery.where(
//       and(
//         this.mapFilterToQuery({
//           filter: this.withTenant<DocumentModel>({
//             and: filters,
//           }),
//           table: documentEntity,
//         }),
//         costCodeFilter,
//         hasProjectFilter
//           ? this.mapFilterToQuery({
//               filter: this.withTenant<DocumentProjectModel>(projectFilterObj),
//               table: documentProjectEntity,
//             })
//           : undefined,
//       ),
//     );

//     return {
//       value: result?.total || 0,
//     };
//   }

//   /**
//    * Retrieves document totals filtered by type and other specified criteria.
//    *
//    * @param {string} projectId - The ID of the project for which document totals are retrieved.
//    * @param {DocumentTypeEnum} documentType - The type of document to filter by.
//    * @param {EntityStatusEnum} [status] - An optional status filter to further narrow down the documents.
//    * @return {Promise<ReportMetricData>} A promise that resolves to an object containing the subtotal and gross total values of the documents, where VAT (tax) can be inferred as the difference between the two.
//    */
//   private async getDocumentTotalsByType(
//     projectId: string | undefined,
//     documentType: DocumentTypeEnum,
//     dateFrom: string,
//     dateTo: string,
//     reportView: ReportViewSelectEntity | undefined,
//     status?: EntityStatusEnum,
//     excludeSupplierReports = false,
//   ): Promise<ReportMetricData> {
//     const db = this.drizzle.db;
//     const tenantCurrencyCode = await this.getTenantCurrencyCode();
//     const projectsForReport = reportView ? this.getProjectsForReport(reportView) : [];
//     const hasProjectFilter = Boolean(projectId) || projectsForReport.length > 0;
//     const projectFilterObj = this.buildScopedFilter('projectId', projectId, projectsForReport);

//     const suppliers = this.getSuppliersForReport(reportView);
//     const costCodeFilter = this.getDocumentCostCodeFilter(this.getCostCodesForReport(reportView));

//     const filterConditions: Filter<DocumentModel>[] = [
//       { documentType: { eq: documentType } },
//       { issueDate: { gte: dateFrom } },
//       { issueDate: { lte: dateTo } },
//     ];

//     if (this.getDocumentStatusesForReport(reportView).length > 0) {
//       filterConditions.push({ status: { in: this.getDocumentStatusesForReport(reportView) } });
//     }

//     if (status !== undefined) {
//       filterConditions.push({ status: { eq: status } });
//     }

//     if (suppliers.length) {
//       filterConditions.push({ supplierId: { in: suppliers } });
//     }

//     let documentTotalsQuery = db
//       .select({
//         subtotal: sum(
//           this.convertDocumentAmountExpr(sql`${documentLineItemEntity.subtotal}`, tenantCurrencyCode),
//         ).mapWith(Number),
//         tax: sum(this.convertDocumentAmountExpr(sql`${documentLineItemEntity.taxAmount}`, tenantCurrencyCode)).mapWith(
//           Number,
//         ),
//         total: sum(this.convertDocumentAmountExpr(sql`${documentLineItemEntity.total}`, tenantCurrencyCode)).mapWith(
//           Number,
//         ),
//       })
//       .from(documentEntity)
//       .leftJoin(supplierEntity, eq(supplierEntity.id, documentEntity.supplierId))
//       .innerJoin(documentLineItemEntity, eq(documentLineItemEntity.documentId, documentEntity.id));

//     if (hasProjectFilter) {
//       documentTotalsQuery = documentTotalsQuery.innerJoin(
//         documentProjectEntity,
//         eq(documentProjectEntity.documentId, documentEntity.id),
//       );
//     }

//     const [result] = await documentTotalsQuery.where(
//       and(
//         this.mapFilterToQuery({
//           filter: this.withTenant<DocumentModel>({
//             and: filterConditions,
//           }),
//           table: documentEntity,
//         }),
//         costCodeFilter,
//         excludeSupplierReports ? sql`coalesce(${supplierEntity.excludeFromReports}, false) = false` : undefined,
//         hasProjectFilter
//           ? this.mapFilterToQuery({
//               filter: this.withTenant<DocumentProjectModel>(projectFilterObj),
//               table: documentProjectEntity,
//             })
//           : undefined,
//       ),
//     );

//     const subtotal = result?.subtotal || 0;
//     const grossTotal = result?.total || 0;

//     return {
//       value: subtotal,
//       secondaryValue: grossTotal,
//       secondaryLabel: 'grossTotal',
//       // Note: VAT (tax) can be calculated on frontend as secondaryValue - value
//       // or, we could store it differently if the interface is extended
//     };
//   }

//   /**
//    * Retrieves the specified metric for a given project.
//    *
//    * @param {ReportMetricEnum} metric - The type of metric to retrieve.
//    * Accepted values correspond to the enumeration `ReportMetricEnum`, such as actual sales or costs.
//    * @param {string | undefined} projectId - The unique identifier of the project ID whose metric is being requested.
//    * @return {Promise<ReportMetricData | null>} A promise that resolves to the metric data if found, or null if the metric is invalid or unavailable.
//    */
//   private getDocumentMetric(
//     metric: ReportMetricEnum,
//     projectId: string | undefined,
//     dateFrom: string,
//     dateTo: string,
//     reportView: ReportViewSelectEntity | undefined,
//   ): Promise<ReportMetricData | null> {
//     switch (metric) {
//       case ReportMetricEnum.ACTUAL_SALES:
//         return this.getProjectActualSalesTotal(projectId, dateFrom, dateTo, reportView);
//       case ReportMetricEnum.ACTUAL_COST:
//         return this.getProjectActualCostTotal(projectId, dateFrom, dateTo, reportView);
//       case ReportMetricEnum.SALES_INVOICES:
//         return this.getDocumentTotalsByType(projectId, DocumentTypeEnum.SALES_INVOICE, dateFrom, dateTo, reportView);
//       case ReportMetricEnum.PURCHASE_ORDERS:
//         return this.getDocumentTotalsByType(projectId, DocumentTypeEnum.PURCHASE_ORDER, dateFrom, dateTo, reportView);
//       case ReportMetricEnum.ACTUAL_COSTS:
//         return this.getDocumentTotalsByType(
//           projectId,
//           DocumentTypeEnum.INVOICE,
//           dateFrom,
//           dateTo,
//           reportView,
//           undefined,
//           true,
//         );
//       case ReportMetricEnum.PAID_COSTS:
//         return this.getDocumentTotalsByType(
//           projectId,
//           DocumentTypeEnum.INVOICE,
//           dateFrom,
//           dateTo,
//           undefined,
//           EntityStatusEnum.PAID,
//           true,
//         );
//       default:
//         return Promise.resolve(null);
//     }
//   }

//   /**
//    * Generates a SQL bucket expression based on the specified time interval and SQL column.
//    *
//    * @param {ReportViewTimeIncrementEnum} interval - The time increment used to bucket the data (e.g. MONTHLY, YEARLY).
//    * @param {SQL} col - The SQL column to be used for bucketing.
//    * @return {SQL} The SQL expression for bucketed data based on the given interval and column.
//    */
//   private bucketExpr(interval: ReportViewTimeIncrementEnum, col: SQL): SQL {
//     if (interval === ReportViewTimeIncrementEnum.MONTHLY)
//       return sql`date_trunc('month'::text, ${col}::timestamp)::date`;
//     if (interval === ReportViewTimeIncrementEnum.YEARLY) return sql`date_trunc('year'::text, ${col}::timestamp)::date`;
//     return sql`date '2000-01-01'`;
//   }

//   /**
//    * Builds a query to generate a series of buckets based on the specified time interval, start date, and end date.
//    *
//    * @param {QueryBuilder} qb - The query builder instance used for generating SQL queries.
//    * @param {ReportViewTimeIncrementEnum} interval - The time increment strategy for bucketing data (e.g., ALL, MONTHLY, YEARLY).
//    * @param {Date} from - The starting date for the bucket generation.
//    * @param {Date} to - The ending date for the bucket generation.
//    * @return {QueryBuilder} A modified query builder instance with the bucketed data query applied.
//    */
//   private bucketSeriesQB(qb: QueryBuilder, interval: ReportViewTimeIncrementEnum, from: Date, to: Date) {
//     if (interval === ReportViewTimeIncrementEnum.ALL) {
//       return qb
//         .select({ bucket: sql<Date>`timestamp '2000-01-01'`.as('bucket') })
//         .from(sql`(select 1)`.as('t') as unknown as SQL);
//     }

//     const trunc = interval === ReportViewTimeIncrementEnum.MONTHLY ? sql`'month'::text` : sql`'year'::text`;

//     const step = interval === ReportViewTimeIncrementEnum.MONTHLY ? sql`interval '1 month'` : sql`interval '1 year'`;

//     return qb.select({ bucket: sql<Date>`bucket::date`.as('bucket') }).from(sql`
//       generate_series(
//         date_trunc(${trunc}, ${from}::timestamp),
//         date_trunc(${trunc}, ${to}::timestamp),
//         ${step}
//       ) as bucket
//     `);
//   }

//   /**
//    * Retrieves the data for the cost report table based on the given parameters. This method performs
//    * complex data aggregation and joins using customised queries to generate cost and budget insights
//    * for the specified project within a defined time range.
//    *
//    * @param {GetCostReportTableArgs} args - The input arguments required to generate the cost report table data.
//    * This includes the following properties:
//    *   - projectId: Identifier for the project for which the report is generated.
//    *   - dateFrom: The start date of the reporting period.
//    *   - dateTo: The end date of the reporting period.
//    *
//    * @return {Promise<ReportRow[]>} A promise that resolves with the structured data for the cost report table,
//    * containing information such as cost code details, contract values, budgets, and incurred costs over a
//    * specific time interval.
//    */
//   async getCostReportTableData(
//     args: GetCostReportTableArgs,
//     groupingDimension: CostReportGroupingStrategyEnum = CostReportGroupingStrategyEnum.BY_COST_CODE,
//     reportView: ReportViewSelectEntity,
//     options?: {
//       pairByCostCodeTag?: boolean;
//       includeProjectDimension?: boolean;
//       interval?: ReportViewTimeIncrementEnum;
//       hideUnassignedCostCodes?: boolean;
//     },
//   ): Promise<ReportRow[]> {
//     const db = this.drizzle.db;
//     const effectiveReportView = reportView.id ? ((await this.getReportView(reportView.id)) ?? reportView) : reportView;

//     const projectId = args.projectId;
//     const from = new Date(args.dateFrom);
//     const to = new Date(args.dateTo);
//     const interval = options?.interval ?? ReportViewTimeIncrementEnum.MONTHLY;
//     const tenantCurrencyCode = await this.getTenantCurrencyCode();
//     const documentStatuses = this.getDocumentStatusesForReport(effectiveReportView);
//     const suppliers = this.getSuppliersForReport(effectiveReportView);
//     const costCodes = this.getCostCodesForReport(effectiveReportView);
//     const hideUnassignedCostCodes = options?.hideUnassignedCostCodes ?? Boolean(costCodes.length);

//     // If a projectId is provided, and we're *not* in "all projects" mode,
//     // constrain all downstream CTEs to that project. Otherwise, leave
//     // the project unconstrained and rely on tenant scoping.
//     // When in "all projects" mode, check if the report view has selected projects.
//     const projectsForReport = this.getProjectsForReport(effectiveReportView);
//     const isProjectScoped = Boolean(projectId && !args.isAllProjects);
//     const isProjectViewFiltered = Boolean(args.isAllProjects && projectsForReport.length > 0);
//     const projectFilter = this.buildScopedFilter(
//       'projectId',
//       isProjectScoped ? projectId : undefined,
//       isProjectViewFiltered ? projectsForReport : [],
//     );
//     const scopedProjectId = isProjectScoped && projectId ? projectId : null;

//     // Helper that generates a project-matching SQL condition for raw SQL CTEs.
//     //   - Single-project mode: (scopedId is null OR col is null OR col = scopedId)
//     //   - Multi-project mode: (col IN (project1, project2, ...) OR col is null)
//     //   - No filter:          true (no constraint)
//     const projectMatchCondition = (col: AnyColumn): SQL => {
//       if (isProjectScoped && scopedProjectId) {
//         return sql`(${scopedProjectId}::uuid is null or ${col} is null or ${col} = ${scopedProjectId})`;
//       }
//       if (isProjectViewFiltered) {
//         return sql`(${col} in (${sql.join(
//           projectsForReport.map(p => sql`${p}`),
//           sql`,`,
//         )}) or ${col} is null)`;
//       }
//       return sql`true`;
//     };

//     const projectMatchConditionExpr = (col: SQL): SQL => {
//       if (isProjectScoped && scopedProjectId) {
//         return sql`(${scopedProjectId}::uuid is null or ${col} is null or ${col} = ${scopedProjectId})`;
//       }
//       if (isProjectViewFiltered) {
//         return sql`(${col} in (${sql.join(
//           projectsForReport.map(p => sql`${p}`),
//           sql`,`,
//         )}) or ${col} is null)`;
//       }
//       return sql`true`;
//     };

//     // Boolean: true when any kind of project filtering is active (single project or multi-project view).
//     const isProjectFiltered = isProjectScoped || isProjectViewFiltered;

//     // SQL fragment that matches a projectId column against the active project filter.
//     //   - Single-project mode: col = scopedProjectId
//     //   - Multi-project mode:  col IN (project1, project2, ...)
//     //   - No filter:           true
//     const projectMatchCol = (col: AnyColumn): SQL => {
//       if (isProjectScoped && scopedProjectId) return sql`${col} = ${scopedProjectId}`;
//       if (isProjectViewFiltered)
//         return sql`${col} in (${sql.join(
//           projectsForReport.map(p => sql`${p}`),
//           sql`,`,
//         )})`;
//       return sql`true`;
//     };

//     const projectMatchColExpr = (col: SQL): SQL => {
//       if (isProjectScoped && scopedProjectId) return sql`${col} = ${scopedProjectId}`;
//       if (isProjectViewFiltered)
//         return sql`${col} in (${sql.join(
//           projectsForReport.map(p => sql`${p}`),
//           sql`,`,
//         )})`;
//       return sql`true`;
//     };

//     const boqProjectScope = this.mapFilterToQuery({
//       filter: this.withTenant<BoqLineItemModel>(projectFilter),
//       table: boqLineItemEntity,
//     });

//     // CTE: time buckets for the selected range (e.g. one row per month).
//     // This is the canonical time axis that everything else joins onto.
//     const bucketsCte = db.$with('buckets').as(qb => this.bucketSeriesQB(qb, interval, from, to));

//     const isTagGrouping = groupingDimension === CostReportGroupingStrategyEnum.BY_TAG;
//     const pairByCostCodeTag = Boolean(options?.pairByCostCodeTag);
//     const includeProjectDimension = Boolean(options?.includeProjectDimension);
//     const isCostCodeTagPairGrouping = pairByCostCodeTag && !isTagGrouping;
//     const projectGroupFilter = this.buildScopedFilter(
//       'id',
//       isProjectScoped ? projectId : undefined,
//       isProjectViewFiltered ? projectsForReport : [],
//     );
//     const allocationEntity = isTagGrouping ? entityCustomTagEntity : entityCostCodeEntity;
//     const allocationCostCodeIdColumn = isTagGrouping
//       ? entityCustomTagEntity.customTagId
//       : entityCostCodeEntity.costCodeId;
//     const allocationDocumentLineItemIdColumn = allocationEntity.documentLineItemId;
//     const allocationTimesheetLineItemIdColumn = allocationEntity.timesheetLineItemId;
//     const documentCostCodeFilter = !isTagGrouping && costCodes.length ? { costCodeId: { in: costCodes } } : undefined;
//     const shouldHideUnassignedCostCodes = hideUnassignedCostCodes && !isTagGrouping;

//     const projectUniverseCte = db.$with('project_universe').as(
//       includeProjectDimension
//         ? db.select({
//             projectId: sql<string | null>`pu.project_id`.as('project_id'),
//             projectName: sql<string | null>`pu.project_name`.as('project_name'),
//             projectStartDate: sql<Date | null>`pu.project_start_date`.as('project_start_date'),
//             projectTargetDate: sql<Date | null>`pu.project_target_date`.as('project_target_date'),
//             totalWeeks: sql<number>`pu.total_weeks`.as('total_weeks'),
//           }).from(sql`
//             (
//               select
//                 ${projectEntity.id} as project_id,
//                 ${projectEntity.name} as project_name,
//                 ${projectEntity.startDate} as project_start_date,
//                 ${projectEntity.estimatedEndDate} as project_target_date,
//                 case
//                   when ${projectEntity.startDate} is null or ${projectEntity.estimatedEndDate} is null then 0
//                   when ${projectEntity.estimatedEndDate} < ${projectEntity.startDate} then 0
//                   else greatest(
//                     1,
//                     ceil(
//                       extract(epoch from (${projectEntity.estimatedEndDate}::timestamp - ${projectEntity.startDate}::timestamp))
//                       / ${60 * 60 * 24 * 7}
//                     )::int
//                   )
//                 end as total_weeks
//               from ${projectEntity}
//               where ${this.mapFilterToQuery({
//                 filter: this.withTenant(projectGroupFilter),
//                 table: projectEntity,
//               })}

//               union all

//               select
//                 null::uuid as project_id,
//                 null::text as project_name,
//                 null::date as project_start_date,
//                 null::date as project_target_date,
//                 0 as total_weeks
//             ) pu
//           `)
//         : db
//             .select({
//               projectId: sql<string | null>`null::uuid`.as('project_id'),
//               projectName: sql<string | null>`null`.as('project_name'),
//               projectStartDate: sql<Date | null>`null::date`.as('project_start_date'),
//               projectTargetDate: sql<Date | null>`null::date`.as('project_target_date'),
//               totalWeeks: sql<number>`0`.as('total_weeks'),
//             })
//             .from(sql`(select 1) as dummy`),
//     );

//     const boqCostCodeAllocCte = db.$with('boq_cost_code_alloc').as(
//       db
//         .select({
//           boqLineItemId: entityCostCodeEntity.boqLineItemId,
//           costCodeId: entityCostCodeEntity.costCodeId,
//           sellRatio: sql<number>`coalesce(
//             ${entityCostCodeEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//             ${entityCostCodeEntity.sellAllocationPercent} / ${PERCENTAGE_DIVISOR},
//             1::numeric / nullif(count(*) over (partition by ${entityCostCodeEntity.boqLineItemId}), 0)
//           )`.as('sell_ratio'),
//           costRatio: sql<number>`coalesce(
//             ${entityCostCodeEntity.costAllocationAmount} / nullif(${boqLineItemEntity.costPrice}, 0),
//             ${entityCostCodeEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//             coalesce(${entityCostCodeEntity.costAllocationPercent}, ${entityCostCodeEntity.sellAllocationPercent}) / ${PERCENTAGE_DIVISOR},
//             1::numeric / nullif(count(*) over (partition by ${entityCostCodeEntity.boqLineItemId}), 0)
//           )`.as('cost_ratio'),
//         })
//         .from(entityCostCodeEntity)
//         .leftJoin(boqLineItemEntity, eq(entityCostCodeEntity.boqLineItemId, boqLineItemEntity.id))
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCostCodeModel>({
//               and: [
//                 projectFilter,
//                 {
//                   boqLineItemId: { isNot: null },
//                 },
//               ],
//             }),
//             table: entityCostCodeEntity,
//           }),
//         ),
//     );

//     const boqAllocCte = db.$with('boq_alloc').as(
//       db
//         .select({
//           boqLineItemId: entityCustomTagEntity.boqLineItemId,
//           costCodeId: entityCustomTagEntity.customTagId,
//           sellRatio: sql<number>`coalesce(
//             ${entityCustomTagEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//             ${entityCustomTagEntity.sellAllocationPercent} / ${PERCENTAGE_DIVISOR},
//             1::numeric / nullif(count(*) over (partition by ${entityCustomTagEntity.boqLineItemId}), 0)
//           )`.as('sell_ratio'),
//           costRatio: sql<number>`coalesce(
//             ${entityCustomTagEntity.costAllocationAmount} / nullif(${boqLineItemEntity.costPrice}, 0),
//             ${entityCustomTagEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//             coalesce(${entityCustomTagEntity.costAllocationPercent}, ${entityCustomTagEntity.sellAllocationPercent}) / ${PERCENTAGE_DIVISOR},
//             1::numeric / nullif(count(*) over (partition by ${entityCustomTagEntity.boqLineItemId}), 0)
//           )`.as('cost_ratio'),
//         })
//         .from(entityCustomTagEntity)
//         .leftJoin(boqLineItemEntity, eq(entityCustomTagEntity.boqLineItemId, boqLineItemEntity.id))
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCustomTagModel>({
//               and: [
//                 projectFilter,
//                 {
//                   boqLineItemId: { isNot: null },
//                   customTagId: { isNot: null },
//                 },
//               ],
//             }),
//             table: entityCustomTagEntity,
//           }),
//         ),
//     );

//     const boqPairTagAllocCte = db.$with('boq_pair_tag_alloc').as(
//       db.select({
//         boqLineItemId: sql<string | null>`u.boq_line_item_id`.as('boq_line_item_id'),
//         costCodeId: sql<string | null>`u.cost_code_id`.as('cost_code_id'),
//         customTagId: sql<string | null>`u.custom_tag_id`.as('custom_tag_id'),
//         sellRatio: sql<number>`u.sell_ratio`.as('sell_ratio'),
//         costRatio: sql<number>`u.cost_ratio`.as('cost_ratio'),
//       }).from(sql`
//           (
//             select
//               ${entityCustomTagEntity.boqLineItemId} as boq_line_item_id,
//               coalesce(${entityCostCodeEntity.costCodeId}, ${boqLineItemEntity.costCodeId}) as cost_code_id,
//               ${entityCustomTagEntity.customTagId} as custom_tag_id,
//               coalesce(
//                 ${entityCustomTagEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//                 ${entityCustomTagEntity.sellAllocationPercent} / ${PERCENTAGE_DIVISOR},
//                 1::numeric / nullif(count(*) over (partition by ${entityCustomTagEntity.boqLineItemId}), 0)
//               ) as sell_ratio,
//               coalesce(
//                 ${entityCustomTagEntity.costAllocationAmount} / nullif(${boqLineItemEntity.costPrice}, 0),
//                 ${entityCustomTagEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//                 coalesce(${entityCustomTagEntity.costAllocationPercent}, ${entityCustomTagEntity.sellAllocationPercent}) / ${PERCENTAGE_DIVISOR},
//                 1::numeric / nullif(count(*) over (partition by ${entityCustomTagEntity.boqLineItemId}), 0)
//               ) as cost_ratio
//             from ${entityCustomTagEntity}
//             left join ${entityCostCodeEntity} on ${entityCustomTagEntity.entityCostCodeId} = ${entityCostCodeEntity.id}
//             left join ${boqLineItemEntity} on ${entityCustomTagEntity.boqLineItemId} = ${boqLineItemEntity.id}
//             where ${this.mapFilterToQuery({
//               filter: this.withTenant<EntityCustomTagModel>({
//                 and: [
//                   projectFilter,
//                   {
//                     boqLineItemId: { isNot: null },
//                     customTagId: { isNot: null },
//                   },
//                 ],
//               }),
//               table: entityCustomTagEntity,
//             })}

//             union all

//             select
//               ${entityCostCodeEntity.boqLineItemId} as boq_line_item_id,
//               ${entityCostCodeEntity.costCodeId} as cost_code_id,
//               null::uuid as custom_tag_id,
//               coalesce(
//                 ${entityCostCodeEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//                 ${entityCostCodeEntity.sellAllocationPercent} / ${PERCENTAGE_DIVISOR},
//                 1::numeric / nullif(count(*) over (partition by ${entityCostCodeEntity.boqLineItemId}), 0)
//               ) as sell_ratio,
//               coalesce(
//                 ${entityCostCodeEntity.costAllocationAmount} / nullif(${boqLineItemEntity.costPrice}, 0),
//                 ${entityCostCodeEntity.sellAllocationAmount} / nullif(${boqLineItemEntity.sellPrice}, 0),
//                 coalesce(${entityCostCodeEntity.costAllocationPercent}, ${entityCostCodeEntity.sellAllocationPercent}) / ${PERCENTAGE_DIVISOR},
//                 1::numeric / nullif(count(*) over (partition by ${entityCostCodeEntity.boqLineItemId}), 0)
//               ) as cost_ratio
//             from ${entityCostCodeEntity}
//             left join ${boqLineItemEntity} on ${entityCostCodeEntity.boqLineItemId} = ${boqLineItemEntity.id}
//             where ${this.mapFilterToQuery({
//               filter: this.withTenant<EntityCostCodeModel>({
//                 and: [
//                   projectFilter,
//                   {
//                     boqLineItemId: { isNot: null },
//                   },
//                 ],
//               }),
//               table: entityCostCodeEntity,
//             })}
//               and not exists (
//                 select 1
//                 from ${entityCustomTagEntity} ect2
//                 where ect2.boq_line_item_id = ${entityCostCodeEntity.boqLineItemId}
//                   and ect2.tenant_id = ${this.tenantId}
//                   and ect2.entity_cost_code_id = ${entityCostCodeEntity.id}
//                   and ect2.custom_tag_id is not null
//                   and ${projectMatchConditionExpr(sql`ect2.project_id`)}
//               )
//           ) u
//         `),
//     );

//     const boqCostCodeAllocCostCodeIdRef = sql<string | null>`"boq_cost_code_alloc"."cost_code_id"`;
//     const boqCostCodeAllocSellRatioRef = sql<number>`"boq_cost_code_alloc"."sell_ratio"`;
//     const boqCostCodeAllocCostRatioRef = sql<number>`"boq_cost_code_alloc"."cost_ratio"`;
//     const boqAllocTagIdRef = sql<string | null>`"boq_alloc"."cost_code_id"`;
//     const boqAllocSellRatioRef = sql<number>`"boq_alloc"."sell_ratio"`;
//     const boqAllocCostRatioRef = sql<number>`"boq_alloc"."cost_ratio"`;
//     const boqPairTagAllocCostCodeIdRef = sql<string | null>`"boq_pair_tag_alloc"."cost_code_id"`;
//     const boqPairTagAllocTagIdRef = sql<string | null>`"boq_pair_tag_alloc"."custom_tag_id"`;
//     const boqPairTagAllocSellRatioRef = sql<number>`"boq_pair_tag_alloc"."sell_ratio"`;
//     const boqPairTagAllocCostRatioRef = sql<number>`"boq_pair_tag_alloc"."cost_ratio"`;
//     const boqPairTagAllocBoqLineItemIdRef = sql<string | null>`"boq_pair_tag_alloc"."boq_line_item_id"`;

//     const boqCostCodeIdExpr = sql<
//       string | null
//     >`coalesce(${boqCostCodeAllocCostCodeIdRef}, ${boqLineItemEntity.costCodeId})`;
//     const boqCostSellRatioExpr = sql<number>`coalesce(${boqCostCodeAllocSellRatioRef}, 1)`;
//     const boqCostRatioExpr = sql<number>`coalesce(${boqCostCodeAllocCostRatioRef}, 1)`;
//     const boqTagIdExpr = sql<string | null>`coalesce(${boqAllocTagIdRef}, ${boqLineItemEntity.customTagId})`;
//     const boqTagSellRatioExpr = sql<number>`coalesce(${boqAllocSellRatioRef}, 1)`;
//     const boqTagCostRatioExpr = sql<number>`coalesce(${boqAllocCostRatioRef}, 1)`;
//     const boqPairCostCodeIdExpr = sql<string | null>`case
//       when ${boqPairTagAllocBoqLineItemIdRef} is not null then ${boqPairTagAllocCostCodeIdRef}
//       else ${boqLineItemEntity.costCodeId}
//     end`;
//     const boqPairTagIdExpr = sql<string | null>`case
//       when ${boqPairTagAllocBoqLineItemIdRef} is not null then ${boqPairTagAllocTagIdRef}
//       else ${boqLineItemEntity.customTagId}
//     end`;
//     const boqPairSellRatioExpr = sql<number>`coalesce(${boqPairTagAllocSellRatioRef}, 1)`;
//     const boqPairCostRatioExpr = sql<number>`coalesce(${boqPairTagAllocCostRatioRef}, 1)`;

//     // CTE: "static" contract values per grouping dimension from the BoQ.
//     // No time dimension here - just total contract value / budget per group key.
//     const boqStaticCte = db.$with('boq_static').as(
//       (() => {
//         if (isTagGrouping) {
//           return db
//             .select({
//               projectId: includeProjectDimension
//                 ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                 : sql<string | null>`null::uuid`.as('project_id'),
//               costCodeId: sql<string | null>`${boqTagIdExpr}`.as('cost_code_id'),
//               customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//               contractValue: sql<number>`sum(${boqLineItemEntity.sellPrice} * ${boqTagSellRatioExpr})`.as(
//                 'contract_value',
//               ),
//               contractBudget: sql<number>`sum(${boqLineItemEntity.costPrice} * ${boqTagCostRatioExpr})`.as(
//                 'contract_budget',
//               ),
//             })
//             .from(boqLineItemEntity)
//             .leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id))
//             .where(
//               this.mapFilterToQuery({
//                 filter: this.withTenant<BoqLineItemModel>({
//                   and: [
//                     projectFilter,
//                     { type: { eq: BoqLineItemTypeEnum.LINE_ITEM } },
//                     { boqDocType: { eq: BoqDocTypeEnum.BOQ } },
//                   ],
//                 }),
//                 table: boqLineItemEntity,
//               }),
//             )
//             .groupBy(includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`, boqTagIdExpr);
//         }

//         if (pairByCostCodeTag) {
//           return db
//             .select({
//               projectId: includeProjectDimension
//                 ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                 : sql<string | null>`null::uuid`.as('project_id'),
//               costCodeId: sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id'),
//               customTagId: sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id'),
//               contractValue: sql<number>`sum(${boqLineItemEntity.sellPrice} * ${boqPairSellRatioExpr})`.as(
//                 'contract_value',
//               ),
//               contractBudget: sql<number>`sum(${boqLineItemEntity.costPrice} * ${boqPairCostRatioExpr})`.as(
//                 'contract_budget',
//               ),
//             })
//             .from(boqLineItemEntity)
//             .leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`)
//             .where(
//               this.mapFilterToQuery({
//                 filter: this.withTenant<BoqLineItemModel>({
//                   and: [
//                     projectFilter,
//                     { type: { eq: BoqLineItemTypeEnum.LINE_ITEM } },
//                     { boqDocType: { eq: BoqDocTypeEnum.BOQ } },
//                   ],
//                 }),
//                 table: boqLineItemEntity,
//               }),
//             )
//             .groupBy(
//               includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//               boqPairCostCodeIdExpr,
//               boqPairTagIdExpr,
//             );
//         }

//         return db
//           .select({
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             contractValue: sql<number>`sum(${boqLineItemEntity.sellPrice} * ${boqCostSellRatioExpr})`.as(
//               'contract_value',
//             ),
//             contractBudget: sql<number>`sum(${boqLineItemEntity.costPrice} * ${boqCostRatioExpr})`.as(
//               'contract_budget',
//             ),
//             customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//           })
//           .from(boqLineItemEntity)
//           .leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id))
//           .where(
//             this.mapFilterToQuery({
//               filter: this.withTenant<BoqLineItemModel>({
//                 and: [
//                   projectFilter,
//                   { type: { eq: BoqLineItemTypeEnum.LINE_ITEM } },
//                   { boqDocType: { eq: BoqDocTypeEnum.BOQ } },
//                 ],
//               }),
//               table: boqLineItemEntity,
//             }),
//           )
//           .groupBy(includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`, boqCostCodeIdExpr);
//       })(),
//     );

//     // CTE: allocation of documents ↔ cost codes.
//     // A single document line item can be tagged with multiple cost codes.
//     // We compute a windowed count(*) so that we can split the line total
//     // evenly across its associated cost codes later.
//     // NOTE: Tenant-scoped to ensure we only see allocations for the current tenant.
//     const docAllocCte = db.$with('doc_alloc').as(
//       db
//         .select({
//           documentLineItemId: allocationDocumentLineItemIdColumn,
//           costCodeId: allocationCostCodeIdColumn,
//           codeCount: sql<number>`count(*) over (partition by ${allocationDocumentLineItemIdColumn})`.as('code_count'),
//         })
//         .from(allocationEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCustomTagModel | EntityCostCodeModel>({
//               and: [
//                 projectFilter,
//                 {
//                   documentLineItemId: { isNot: null },
//                 },
//                 ...(documentCostCodeFilter ? [documentCostCodeFilter] : []),
//               ],
//             }),
//             table: allocationEntity,
//           }),
//         ),
//     );

//     // CTE: allocation of timesheet line items ↔ cost codes.
//     // A single timesheet line item can be tagged with multiple cost codes.
//     // We compute a windowed count(*) so that we can split the line total
//     // evenly across its associated cost codes later.
//     // NOTE: Tenant-scoped to ensure we only see allocations for the current tenant.
//     const timesheetAllocCte = db.$with('timesheet_alloc').as(
//       db
//         .select({
//           timesheetLineItemId: allocationTimesheetLineItemIdColumn,
//           costCodeId: allocationCostCodeIdColumn,
//           codeCount: sql<number>`count(*) over (partition by ${allocationTimesheetLineItemIdColumn})`.as('code_count'),
//         })
//         .from(allocationEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCustomTagModel | EntityCostCodeModel>({
//               and: [
//                 projectFilter,
//                 {
//                   timesheetLineItemId: { isNot: null },
//                 },
//               ],
//             }),
//             table: allocationEntity,
//           }),
//         ),
//     );

//     const docTagAllocCte = db.$with('doc_tag_alloc').as(
//       db
//         .select({
//           documentLineItemId: entityCustomTagEntity.documentLineItemId,
//           customTagId: entityCustomTagEntity.customTagId,
//           tagCount: sql<number>`count(*) over (partition by ${entityCustomTagEntity.documentLineItemId})`.as(
//             'tag_count',
//           ),
//         })
//         .from(entityCustomTagEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCustomTagModel>({
//               and: [
//                 projectFilter,
//                 {
//                   documentLineItemId: { isNot: null },
//                   customTagId: { isNot: null },
//                 },
//               ],
//             }),
//             table: entityCustomTagEntity,
//           }),
//         ),
//     );

//     const timesheetTagAllocCte = db.$with('timesheet_tag_alloc').as(
//       db
//         .select({
//           timesheetLineItemId: entityCustomTagEntity.timesheetLineItemId,
//           customTagId: entityCustomTagEntity.customTagId,
//           tagCount: sql<number>`count(*) over (partition by ${entityCustomTagEntity.timesheetLineItemId})`.as(
//             'tag_count',
//           ),
//         })
//         .from(entityCustomTagEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCustomTagModel>({
//               and: [
//                 projectFilter,
//                 {
//                   timesheetLineItemId: { isNot: null },
//                   customTagId: { isNot: null },
//                 },
//               ],
//             }),
//             table: entityCustomTagEntity,
//           }),
//         ),
//     );

//     // Use issue_date for actuals to filter by when documents were issued
//     const documentDateCol: SQL = sql`${documentEntity.issueDate}`;
//     // Use the timesheet week start so report period filtering matches the timesheet flows.
//     const timesheetLineItemDateCol: SQL = sql`${timesheetEntity.startOfWeek}`;

//     // CTE: "actual" costs per (bucket, costCodeId) from project financial documents.
//     // - Aggregates line item subtotals using signed values:
//     //   • INVOICE / RECEIPT / ACCRUAL → added
//     //   • CREDIT_NOTE → subtracted
//     // - Uses docAllocCte.codeCount to distribute each document line item subtotal
//     //   evenly across its linked cost codes.
//     // - If a document line item has no cost code assignments, it’s included with NULL cost code.
//     // - Filtered to documents that are APPROVED or PAID for the current tenant / project context.
//     // - Uses issue_date for time bucketing to reflect when documents were issued.
//     // - Uses subtotal (before VAT), not document totals.

//     const documentActualCte = db.$with('document_actual_costs').as(
//       (() => {
//         let stmt = db
//           .select({
//             bucket: this.bucketExpr(interval, documentDateCol).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${documentLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: sql<string | null>`${docAllocCte.costCodeId}`.as('cost_code_id'),
//             customTagId: pairByCostCodeTag
//               ? sql<string | null>`${docTagAllocCte.customTagId}`.as('custom_tag_id')
//               : sql<string | null>`null`.as('custom_tag_id'),
//             value: sql<number>`
//               sum(
//                 ${this.convertDocumentAmountExpr(
//                   sql`
//                 case
//                   when ${documentEntity.documentType} in (
//                     ${sql.join([DocumentTypeEnum.INVOICE, DocumentTypeEnum.RECEIPT, DocumentTypeEnum.ACCRUAL], sql`,`)}
//                   )
//                     then ${documentLineItemEntity.subtotal}
//                   when ${documentEntity.documentType} = ${DocumentTypeEnum.CREDIT_NOTE}
//                     then -${documentLineItemEntity.subtotal}
//                   else 0
//                 end
//                 `,
//                   tenantCurrencyCode,
//                 )}
//                 /
//                 coalesce(nullif(${docAllocCte.codeCount}, 0), 1)
//                 /
//                 ${pairByCostCodeTag ? sql`coalesce(nullif(${docTagAllocCte.tagCount}, 0), 1)` : sql`1`}
//               )
//             `.as('value'),
//           })
//           .from(documentEntity)
//           .leftJoin(supplierEntity, eq(supplierEntity.id, documentEntity.supplierId))
//           .innerJoin(documentLineItemEntity, eq(documentLineItemEntity.documentId, documentEntity.id))
//           .leftJoin(docAllocCte, eq(docAllocCte.documentLineItemId, documentLineItemEntity.id));

//         if (pairByCostCodeTag) {
//           stmt = stmt.leftJoin(docTagAllocCte, eq(docTagAllocCte.documentLineItemId, documentLineItemEntity.id));
//         }

//         if (isProjectFiltered) {
//           stmt = stmt.innerJoin(documentProjectEntity, eq(documentProjectEntity.documentId, documentEntity.id));
//         }

//         return stmt
//           .where(
//             and(
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   status: { in: documentStatuses },
//                   issueDate: { isNot: null, gte: from, lte: to },
//                   ...(suppliers?.length ? { supplierId: { in: suppliers } } : {}),
//                 }),
//                 table: documentEntity,
//               }),
//               shouldHideUnassignedCostCodes ? sql`${docAllocCte.costCodeId} is not null` : undefined,
//               sql`coalesce(${supplierEntity.excludeFromReports}, false) = false`,
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant<DocumentProjectModel>(projectFilter),
//                     table: documentProjectEntity,
//                   })
//                 : undefined,
//               // Important for multi-project documents: line items are project-scoped.
//               // Without this, line items for other projects can fall through as NULL cost code ("Unassigned").
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant(projectFilter),
//                     table: documentLineItemEntity,
//                   })
//                 : undefined,
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, documentDateCol),
//             includeProjectDimension ? documentLineItemEntity.projectId : sql`null::uuid`,
//             sql`${docAllocCte.costCodeId}`,
//             pairByCostCodeTag ? sql`${docTagAllocCte.customTagId}` : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: "actual" sales per (bucket, costCodeId) from sales invoice/credit note documents.
//     // - Uses docAllocCte.codeCount to distribute each document line item subtotal
//     //   evenly across its linked cost codes.
//     // - If a document line item has no cost code assignments, it's included with NULL cost code.
//     // - Filtered to sales documents (SALES_INVOICE or CREDIT_NOTE with clientId) that are
//     //   PENDING, APPROVED, or PAID for the current tenant / project context.
//     // - Uses issue_date for bucketing to reflect when documents were issued.
//     // - Uses subtotal (before VAT) instead of total.
//     const actualSalesCte = db.$with('actual_sales').as(
//       (() => {
//         let stmt = db
//           .select({
//             bucket: this.bucketExpr(interval, documentDateCol).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${documentLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: sql<string | null>`${docAllocCte.costCodeId}`.as('cost_code_id'),
//             customTagId: pairByCostCodeTag
//               ? sql<string | null>`${docTagAllocCte.customTagId}`.as('custom_tag_id')
//               : sql<string | null>`null`.as('custom_tag_id'),
//             value: sql<number>`
//               sum(
//                 ${this.convertDocumentAmountExpr(
//                   sql`
//                   (
//                     case
//                       when ${documentEntity.documentType} = ${DocumentTypeEnum.SALES_INVOICE}
//                         then ${documentLineItemEntity.subtotal}
//                       when ${documentEntity.documentType} = ${DocumentTypeEnum.SALES_CREDIT_NOTE}
//                         then -${documentLineItemEntity.subtotal}
//                       else 0
//                     end
//                   )
//                   `,
//                   tenantCurrencyCode,
//                 )}
//                 /
//                 coalesce(nullif(${docAllocCte.codeCount}, 0), 1)
//                 /
//                 ${pairByCostCodeTag ? sql`coalesce(nullif(${docTagAllocCte.tagCount}, 0), 1)` : sql`1`}
//               )
//             `.as('value'),
//           })
//           .from(documentEntity)
//           .innerJoin(documentLineItemEntity, eq(documentLineItemEntity.documentId, documentEntity.id))
//           .leftJoin(docAllocCte, eq(docAllocCte.documentLineItemId, documentLineItemEntity.id));

//         if (pairByCostCodeTag) {
//           stmt = stmt.leftJoin(docTagAllocCte, eq(docTagAllocCte.documentLineItemId, documentLineItemEntity.id));
//         }

//         if (isProjectFiltered) {
//           stmt = stmt.innerJoin(documentProjectEntity, eq(documentProjectEntity.documentId, documentEntity.id));
//         }

//         return stmt
//           .where(
//             and(
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   status: { in: documentStatuses },
//                   issueDate: { isNot: null, gte: from, lte: to },
//                   documentType: {
//                     in: [DocumentTypeEnum.SALES_INVOICE, DocumentTypeEnum.SALES_CREDIT_NOTE],
//                   },
//                   ...(suppliers?.length ? { supplierId: { in: suppliers } } : {}),
//                 }),
//                 table: documentEntity,
//               }),
//               shouldHideUnassignedCostCodes ? sql`${docAllocCte.costCodeId} is not null` : undefined,
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant<DocumentProjectModel>(projectFilter),
//                     table: documentProjectEntity,
//                   })
//                 : undefined,
//               // Important for multi-project documents: line items are project-scoped.
//               // Without this, line items for other projects can fall through as NULL cost code ("Unassigned").
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant(projectFilter),
//                     table: documentLineItemEntity,
//                   })
//                 : undefined,
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, documentDateCol),
//             includeProjectDimension ? documentLineItemEntity.projectId : sql`null::uuid`,
//             sql`${docAllocCte.costCodeId}`,
//             pairByCostCodeTag ? sql`${docTagAllocCte.customTagId}` : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: "actual" costs per (bucket, costCodeId) from approved timesheets.
//     // - Uses timesheetAllocCte.codeCount to distribute each timesheet line item total
//     //   evenly across its linked cost codes.
//     // - If a timesheet line item has no cost code assignments, it's included with NULL cost code.
//     // - Filtered to APPROVED timesheets for the current tenant / project context.
//     // - Uses line item date for bucketing to reflect when work was performed
//     // - Only includes line items with date set (i.e., line items with a work date)
//     const timesheetActualCte = db.$with('timesheet_actual_costs').as(
//       (() => {
//         let stmt = db
//           .select({
//             bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${timesheetLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: sql<string | null>`${timesheetAllocCte.costCodeId}`.as('cost_code_id'),
//             customTagId: pairByCostCodeTag
//               ? sql<string | null>`${timesheetTagAllocCte.customTagId}`.as('custom_tag_id')
//               : sql<string | null>`null`.as('custom_tag_id'),
//             value: sql<number>`
//               sum(
//                 ${timesheetLineItemEntity.subtotal} /
//                 coalesce(nullif(${timesheetAllocCte.codeCount}, 0), 1)
//                 /
//                 ${pairByCostCodeTag ? sql`coalesce(nullif(${timesheetTagAllocCte.tagCount}, 0), 1)` : sql`1`}
//               )
//             `.as('value'),
//           })
//           .from(timesheetLineItemEntity)
//           .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//           .leftJoin(timesheetAllocCte, eq(timesheetAllocCte.timesheetLineItemId, timesheetLineItemEntity.id));

//         if (isProjectFiltered) {
//           stmt = stmt.innerJoin(timesheetProjectEntity, eq(timesheetProjectEntity.timesheetId, timesheetEntity.id));
//         }

//         if (pairByCostCodeTag) {
//           stmt = stmt.leftJoin(
//             timesheetTagAllocCte,
//             eq(timesheetTagAllocCte.timesheetLineItemId, timesheetLineItemEntity.id),
//           );
//         }

//         return stmt
//           .where(
//             and(
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   status: { eq: EntityStatusEnum.APPROVED },
//                   startOfWeek: { gte: from, lte: to },
//                 }),
//                 table: timesheetEntity,
//               }),
//               shouldHideUnassignedCostCodes ? sql`${timesheetAllocCte.costCodeId} is not null` : undefined,
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant(projectFilter),
//                     table: timesheetProjectEntity,
//                   })
//                 : undefined,
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   date: { isNot: null },
//                 }),
//                 table: timesheetLineItemEntity,
//               }),
//               isProjectFiltered
//                 ? this.mapFilterToQuery({
//                     filter: this.withTenant(projectFilter),
//                     table: timesheetLineItemEntity,
//                   })
//                 : undefined,
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, timesheetLineItemDateCol),
//             includeProjectDimension ? timesheetLineItemEntity.projectId : sql`null::uuid`,
//             sql`${timesheetAllocCte.costCodeId}`,
//             pairByCostCodeTag ? sql`${timesheetTagAllocCte.customTagId}` : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: Combined "actual" costs from both documents and timesheets.
//     // This unions document costs and timesheet costs, then aggregates by bucket and cost code.
//     const actualCostCte = db.$with('actual_costs').as(
//       db
//         .select({
//           bucket: sql<Date>`u.bucket`.as('bucket'),
//           projectId: sql<string | null>`u.project_id`.as('project_id'),
//           costCodeId: sql<string | null>`u.cost_code_id`.as('cost_code_id'),
//           customTagId: sql<string | null>`u.custom_tag_id`.as('custom_tag_id'),
//           value: sql<number>`sum(u.value)`.as('value'),
//         })
//         .from(
//           sql`
//             (
//               select bucket, project_id, cost_code_id, custom_tag_id, value from ${documentActualCte}
//               union all
//               select bucket, project_id, cost_code_id, custom_tag_id, value from ${timesheetActualCte}
//             ) as u
//           `,
//         )
//         .groupBy(sql`u.bucket`, sql`u.project_id`, sql`u.cost_code_id`, sql`u.custom_tag_id`),
//     );

//     /**
//      * Helper function to create a valuation value CTE that calculates the raw sum of amounts.
//      * This is the total period value linked to cost codes (before retention & VAT).
//      *
//      * @param amountField - The amount field to use (e.g., appliedAmount, certifiedAmount)
//      * @param dateField - The date field to use for bucketing (e.g., date)
//      * @param includeStatusFilter - Whether to include status filter for APPROVED/COMPLETE/LOCKED
//      * @param requireDateNotNull - Whether to require the date field to be not NULL (adds date: { isNot: null } to filter)
//      */
//     const createValuationValueCte = (amountField: SQL, dateField: SQL, requireDateNotNull = false) => {
//       const baseQuery = isTagGrouping
//         ? db
//             .select({
//               bucket: this.bucketExpr(interval, dateField).as('bucket'),
//               projectId: includeProjectDimension
//                 ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                 : sql<string | null>`null::uuid`.as('project_id'),
//               costCodeId: sql<string | null>`${boqTagIdExpr}`.as('cost_code_id'),
//               customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//               value: sql<number>`sum(COALESCE(${amountField}, 0) * ${boqTagSellRatioExpr})`.as('value'),
//             })
//             .from(valuationLineItemEntity)
//             .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id))
//             .leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id))
//             .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//         : isCostCodeTagPairGrouping
//           ? db
//               .select({
//                 bucket: this.bucketExpr(interval, dateField).as('bucket'),
//                 projectId: includeProjectDimension
//                   ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                   : sql<string | null>`null::uuid`.as('project_id'),
//                 costCodeId: sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id'),
//                 customTagId: sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id'),
//                 value: sql<number>`sum(COALESCE(${amountField}, 0) * ${boqPairSellRatioExpr})`.as('value'),
//               })
//               .from(valuationLineItemEntity)
//               .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id))
//               .leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`)
//               .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           : db
//               .select({
//                 bucket: this.bucketExpr(interval, dateField).as('bucket'),
//                 projectId: includeProjectDimension
//                   ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                   : sql<string | null>`null::uuid`.as('project_id'),
//                 costCodeId: sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//                 customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//                 value: sql<number>`sum(COALESCE(${amountField}, 0) * ${boqCostSellRatioExpr})`.as('value'),
//               })
//               .from(valuationLineItemEntity)
//               .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id))
//               .leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id))
//               .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id));

//       // Build the valuation filter with project scoping and status conditions
//       const valuationFilter: Filter<ValuationModel> = {
//         ...projectFilter,
//       };

//       valuationFilter.publicationStatus = { eq: PublicationStatusEnum.PUBLISHED };

//       if (requireDateNotNull) {
//         valuationFilter.date = { isNot: null, gte: args.dateFrom, lte: args.dateTo };
//       }

//       const whereConditions = [
//         this.mapFilterToQuery({
//           filter: this.withTenant(valuationFilter),
//           table: valuationEntity,
//         }),
//         boqProjectScope,
//         eq(valuationLineItemEntity.type, BoqLineItemTypeEnum.LINE_ITEM),
//       ];

//       return (
//         /* @coreloops-ignore-tenant-check - tenant filter exists in the base query via projectFilter */
//         baseQuery
//           .where(and(...whereConditions))
//           .groupBy(
//             this.bucketExpr(interval, dateField),
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           )
//       );
//     };

//     // CTE: applied value per (bucket, costCodeId).
//     // Calculates: % applied * value (appliedPercent * sellPrice) for all line items linked to this cost code.
//     // Condition: Application must be published and in any other status BUT draft.
//     // Date filter: valuation Date.
//     const appliedValueCte = db.$with('applied_value').as(
//       (() => {
//         let query = db
//           .select({
//             bucket: this.bucketExpr(interval, sql`${valuationEntity.date}`).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: isTagGrouping
//               ? sql<string | null>`${boqTagIdExpr}`.as('cost_code_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id')
//                 : sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: isTagGrouping
//               ? sql<string | null>`null::uuid`.as('custom_tag_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id')
//                 : sql<string | null>`null::uuid`.as('custom_tag_id'),
//             value: isTagGrouping
//               ? sql<number>`sum((${boqLineItemEntity.sellPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqTagSellRatioExpr})`.as(
//                   'value',
//                 )
//               : isCostCodeTagPairGrouping
//                 ? sql<number>`sum((${boqLineItemEntity.sellPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqPairSellRatioExpr})`.as(
//                     'value',
//                   )
//                 : sql<number>`sum((${boqLineItemEntity.sellPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqCostSellRatioExpr})`.as(
//                     'value',
//                   ),
//           })
//           .from(valuationLineItemEntity)
//           .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id));

//         if (isTagGrouping) {
//           query = query.leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id));
//         } else if (isCostCodeTagPairGrouping) {
//           query = query.leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`);
//         } else {
//           query = query.leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id));
//         }

//         return query
//           .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           .where(
//             and(
//               boqProjectScope,
//               this.mapFilterToQuery({
//                 filter: this.withTenant(projectFilter),
//                 table: valuationEntity,
//               }),
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   publicationStatus: { eq: PublicationStatusEnum.PUBLISHED },
//                   date: { isNot: null, gte: from, lte: to },
//                 }),
//                 table: valuationEntity,
//               }),
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, sql`${valuationEntity.date}`),
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: applied budget per (bucket, costCodeId).
//     // Same as applied value, but using cost (BoQ cost price) instead of sell price.
//     // Uses valuation.date for bucketing since applied values are not yet certified
//     // Condition: Application must be published and in any other status BUT draft.
//     const appliedBudgetCte = db.$with('applied_budget').as(
//       (() => {
//         let query = db
//           .select({
//             bucket: this.bucketExpr(interval, sql`${valuationEntity.date}`).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: isTagGrouping
//               ? sql<string | null>`${boqTagIdExpr}`.as('cost_code_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id')
//                 : sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: isTagGrouping
//               ? sql<string | null>`null::uuid`.as('custom_tag_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id')
//                 : sql<string | null>`null::uuid`.as('custom_tag_id'),
//             value: isTagGrouping
//               ? sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqTagCostRatioExpr})`.as(
//                   'value',
//                 )
//               : isCostCodeTagPairGrouping
//                 ? sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqPairCostRatioExpr})`.as(
//                     'value',
//                   )
//                 : sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.appliedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqCostRatioExpr})`.as(
//                     'value',
//                   ),
//           })
//           .from(valuationLineItemEntity)
//           .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id));

//         if (isTagGrouping) {
//           query = query.leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id));
//         } else if (isCostCodeTagPairGrouping) {
//           query = query.leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`);
//         } else {
//           query = query.leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id));
//         }

//         return query
//           .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           .where(
//             and(
//               boqProjectScope,
//               this.mapFilterToQuery({
//                 filter: this.withTenant(projectFilter),
//                 table: valuationEntity,
//               }),
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   publicationStatus: { eq: PublicationStatusEnum.PUBLISHED },
//                   date: { isNot: null, gte: from, lte: to },
//                 }),
//                 table: valuationEntity,
//               }),
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, sql`${valuationEntity.date}`),
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: certified value per (bucket, costCodeId).
//     // Calculates: % certified * value (certifiedPercent * sellPrice) for all line items linked to this cost code.
//     // Condition: Application must be published and in any other status BUT draft.
//     // Date filter: Valuation Date.
//     const certifiedValueCte = db.$with('certified_value').as(
//       (() => {
//         let query = db
//           .select({
//             bucket: this.bucketExpr(interval, sql`${valuationEntity.date}`).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: isTagGrouping
//               ? sql<string | null>`${boqTagIdExpr}`.as('cost_code_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id')
//                 : sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: isTagGrouping
//               ? sql<string | null>`null::uuid`.as('custom_tag_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id')
//                 : sql<string | null>`null::uuid`.as('custom_tag_id'),
//             value: isTagGrouping
//               ? sql<number>`sum(${valuationLineItemEntity.certifiedAmount} * ${boqTagSellRatioExpr})`.as('value')
//               : isCostCodeTagPairGrouping
//                 ? sql<number>`sum(${valuationLineItemEntity.certifiedAmount} * ${boqPairSellRatioExpr})`.as('value')
//                 : sql<number>`sum(${valuationLineItemEntity.certifiedAmount} * ${boqCostSellRatioExpr})`.as('value'),
//           })
//           .from(valuationLineItemEntity)
//           .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id));

//         if (isTagGrouping) {
//           query = query.leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id));
//         } else if (isCostCodeTagPairGrouping) {
//           query = query.leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`);
//         } else {
//           query = query.leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id));
//         }

//         return query
//           .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           .where(
//             and(
//               boqProjectScope,
//               this.mapFilterToQuery({
//                 filter: this.withTenant(projectFilter),
//                 table: valuationEntity,
//               }),
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   publicationStatus: { eq: PublicationStatusEnum.PUBLISHED },
//                   date: { isNot: null, gte: from, lte: to },
//                 }),
//                 table: valuationEntity,
//               }),
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, sql`${valuationEntity.date}`),
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: certified budget per (bucket, costCodeId).
//     // Certified% applied to BoQ cost price.
//     // Uses date for bucketing to reflect when valuations were certified
//     // Only includes valuations with date set (i.e., certified valuations)
//     const certifiedBudgetCte = db.$with('certified_budget').as(
//       (() => {
//         let query = db
//           .select({
//             bucket: this.bucketExpr(interval, sql`${valuationEntity.date}`).as('bucket'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: isTagGrouping
//               ? sql<string | null>`${boqTagIdExpr}`.as('cost_code_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id')
//                 : sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: isTagGrouping
//               ? sql<string | null>`null::uuid`.as('custom_tag_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id')
//                 : sql<string | null>`null::uuid`.as('custom_tag_id'),
//             value: isTagGrouping
//               ? sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.certifiedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqTagCostRatioExpr})`.as(
//                   'value',
//                 )
//               : isCostCodeTagPairGrouping
//                 ? sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.certifiedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqPairCostRatioExpr})`.as(
//                     'value',
//                   )
//                 : sql<number>`sum((${boqLineItemEntity.costPrice} * (${valuationLineItemEntity.certifiedPercent} / ${PERCENTAGE_DIVISOR})) * ${boqCostRatioExpr})`.as(
//                     'value',
//                   ),
//           })
//           .from(valuationLineItemEntity)
//           .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id));

//         if (isTagGrouping) {
//           query = query.leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id));
//         } else if (isCostCodeTagPairGrouping) {
//           query = query.leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`);
//         } else {
//           query = query.leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id));
//         }

//         return query
//           .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           .where(
//             and(
//               boqProjectScope,
//               this.mapFilterToQuery({
//                 filter: this.withTenant(projectFilter),
//                 table: valuationEntity,
//               }),
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   publicationStatus: { eq: PublicationStatusEnum.PUBLISHED },
//                   date: { isNot: null, gte: from, lte: to },
//                 }),
//                 table: valuationEntity,
//               }),
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, sql`${valuationEntity.date}`),
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           );
//       })(),
//     );

//     // CTE: period applied value per (bucket, costCodeId).
//     // Calculates: The delta applied in THIS application period for this cost code.
//     // This must be the difference between current application's total valuation and the previous application's total valuation.
//     // Source: valuation_line_items.period_applied_amount (already computed at line-item level).
//     // Date filter: Valuation Date.
//     const periodAppliedCte = db.$with('period_applied').as(
//       createValuationValueCte(
//         sql`${valuationLineItemEntity.periodAppliedAmount}`,
//         sql`${valuationEntity.date}`,
//         true, // Require date not null
//       ),
//     );

//     // CTE: period certified value per (bucket, costCodeId).
//     // Calculates: The delta certified in THIS certification period for this cost code.
//     // Source: valuation_line_items.period_certified_amount (already computed at line-item level).
//     // Date filter: Valuation Date.
//     const periodCertifiedCte = db.$with('period_certified').as(
//       createValuationValueCte(
//         sql`${valuationLineItemEntity.periodCertifiedAmount}`,
//         sql`${valuationEntity.date}`,
//         true, // Require date not null
//       ),
//     );

//     // CTE: payment application derived metrics per valuation + (bucket, costCodeId).
//     // We derive payment metrics at the PA level first, then sum those PA-level rows inside a period bucket.
//     // This avoids blending multiple PAs together before net valuation / payment due are calculated.
//     const paymentMetricsRawCte = db.$with('payment_metrics_raw').as(
//       (() => {
//         const valueSplitExpr = isCostCodeTagPairGrouping
//           ? boqPairSellRatioExpr
//           : isTagGrouping
//             ? boqTagSellRatioExpr
//             : boqCostSellRatioExpr;
//         const budgetSplitExpr = isCostCodeTagPairGrouping
//           ? boqPairCostRatioExpr
//           : isTagGrouping
//             ? boqTagCostRatioExpr
//             : boqCostRatioExpr;

//         let query = db
//           .select({
//             bucket: this.bucketExpr(interval, sql`${valuationEntity.date}`).as('bucket'),
//             valuationId: sql<string>`${valuationEntity.id}`.as('valuation_id'),
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: isTagGrouping
//               ? sql<string | null>`${boqTagIdExpr}`.as('cost_code_id')
//               : isCostCodeTagPairGrouping
//                 ? sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id')
//                 : sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: isCostCodeTagPairGrouping
//               ? sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id')
//               : sql<string | null>`null::uuid`.as('custom_tag_id'),
//             totalRetentionApplied: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.appliedAmount}, 0) *
//                   (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${valueSplitExpr}
//               )
//             `.as('total_retention_applied'),
//             totalRetentionCertified: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.certifiedAmount}, 0) *
//                   (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${valueSplitExpr}
//               )
//             `.as('total_retention_certified'),
//             previouslyApplied: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) -
//                   (
//                     coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) *
//                     (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                   )
//                 ) * ${valueSplitExpr}
//               )
//             `.as('previously_applied'),
//             previouslyCertified: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) -
//                   (
//                     coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) *
//                     (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                   )
//                 ) * ${valueSplitExpr}
//               )
//             `.as('previously_certified'),
//             periodAppliedBudget: sql<number>`
//               sum(
//                 (
//                   coalesce(${boqLineItemEntity.costPrice}, 0) *
//                   (coalesce(${valuationLineItemEntity.periodAppliedPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${budgetSplitExpr}
//               )
//             `.as('period_applied_budget'),
//             periodCertifiedBudget: sql<number>`
//               sum(
//                 (
//                   coalesce(${boqLineItemEntity.costPrice}, 0) *
//                   (coalesce(${valuationLineItemEntity.periodCertifiedPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${budgetSplitExpr}
//               )
//             `.as('period_certified_budget'),
//             periodRetentionApplied: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.periodAppliedAmount}, 0) *
//                   (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${valueSplitExpr}
//               )
//             `.as('period_retention_applied'),
//             periodRetentionCertified: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.periodCertifiedAmount}, 0) *
//                   (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                 ) * ${valueSplitExpr}
//               )
//             `.as('period_retention_certified'),
//             netValuationApplied: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.appliedAmount}, 0) -
//                   (
//                     coalesce(${valuationLineItemEntity.appliedAmount}, 0) *
//                     (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                   )
//                 ) * ${valueSplitExpr}
//               )
//             `.as('net_valuation_applied'),
//             netValuationCertified: sql<number>`
//               sum(
//                 (
//                   coalesce(${valuationLineItemEntity.certifiedAmount}, 0) -
//                   (
//                     coalesce(${valuationLineItemEntity.certifiedAmount}, 0) *
//                     (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                   )
//                 ) * ${valueSplitExpr}
//               )
//             `.as('net_valuation_certified'),
//             grossPaymentDueApplied: sql<number>`
//               (
//                 sum(
//                   (
//                     coalesce(${valuationLineItemEntity.appliedAmount}, 0) -
//                     (
//                       coalesce(${valuationLineItemEntity.appliedAmount}, 0) *
//                       (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                     )
//                   ) * ${valueSplitExpr}
//                 ) -
//                 sum(
//                   (
//                     coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) -
//                     (
//                       coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) *
//                       (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                     )
//                   ) * ${valueSplitExpr}
//                 )
//               )
//             `.as('gross_payment_due_applied'),
//             grossPaymentDueCertified: sql<number>`
//               (
//                 sum(
//                   (
//                     coalesce(${valuationLineItemEntity.certifiedAmount}, 0) -
//                     (
//                       coalesce(${valuationLineItemEntity.certifiedAmount}, 0) *
//                       (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                     )
//                   ) * ${valueSplitExpr}
//                 ) -
//                 sum(
//                   (
//                     coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) -
//                     (
//                       coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) *
//                       (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                     )
//                   ) * ${valueSplitExpr}
//                 )
//               )
//             `.as('gross_payment_due_certified'),
//             vatApplied: sql<number>`
//               (
//                 (
//                   sum(
//                     (
//                       coalesce(${valuationLineItemEntity.appliedAmount}, 0) -
//                       (
//                         coalesce(${valuationLineItemEntity.appliedAmount}, 0) *
//                           (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                       )
//                     ) * ${valueSplitExpr}
//                   ) -
//                   sum(
//                     (
//                       coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) -
//                       (
//                         coalesce(${valuationLineItemEntity.previouslyAppliedAmount}, 0) *
//                           (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                       )
//                     ) * ${valueSplitExpr}
//                   )
//                 ) * (coalesce(max(${valuationEntity.vatAmount}), 0) / ${PERCENTAGE_DIVISOR})
//               )
//             `.as('vat_applied'),
//             vatCertified: sql<number>`
//               (
//                 (
//                   sum(
//                     (
//                       coalesce(${valuationLineItemEntity.certifiedAmount}, 0) -
//                       (
//                         coalesce(${valuationLineItemEntity.certifiedAmount}, 0) *
//                           (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                       )
//                     ) * ${valueSplitExpr}
//                   ) -
//                   sum(
//                     (
//                       coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) -
//                       (
//                         coalesce(${valuationLineItemEntity.previouslyCertifiedAmount}, 0) *
//                           (coalesce(${valuationLineItemEntity.retentionPercentage}, 0) / ${PERCENTAGE_DIVISOR})
//                       )
//                     ) * ${valueSplitExpr}
//                   )
//                 ) * (coalesce(max(${valuationEntity.vatAmount}), 0) / ${PERCENTAGE_DIVISOR})
//               )
//             `.as('vat_certified'),
//             vatPercentage: sql<number>`coalesce(max(${valuationEntity.vatAmount}), 0)`.as('vat_percentage'),
//             netForecastValue: sql<number>`
//               sum(coalesce(${boqLineItemEntity.sellPrice}, 0) * ${valueSplitExpr})
//             `.as('net_forecast_value'),
//             netForecastBudget: sql<number>`
//               sum(coalesce(${boqLineItemEntity.costPrice}, 0) * ${budgetSplitExpr})
//             `.as('net_forecast_budget'),
//             paymentApplicationNumber: sql<string>`coalesce(nullif(${valuationEntity.title}, ''), '')`.as(
//               'payment_application_number',
//             ),
//           })
//           .from(valuationLineItemEntity)
//           .innerJoin(boqLineItemEntity, eq(valuationLineItemEntity.boqLineItemId, boqLineItemEntity.id));

//         if (isTagGrouping) {
//           query = query.leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id));
//         } else if (isCostCodeTagPairGrouping) {
//           query = query.leftJoin(boqPairTagAllocCte, sql`${boqPairTagAllocBoqLineItemIdRef} = ${boqLineItemEntity.id}`);
//         } else {
//           query = query.leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id));
//         }

//         return query
//           .innerJoin(valuationEntity, eq(valuationLineItemEntity.valuationId, valuationEntity.id))
//           .where(
//             and(
//               boqProjectScope,
//               this.mapFilterToQuery({
//                 filter: this.withTenant(projectFilter),
//                 table: valuationEntity,
//               }),
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   publicationStatus: { eq: PublicationStatusEnum.PUBLISHED },
//                   date: { isNot: null, gte: from, lte: to },
//                 }),
//                 table: valuationEntity,
//               }),
//               eq(valuationLineItemEntity.type, BoqLineItemTypeEnum.LINE_ITEM),
//             ),
//           )
//           .groupBy(
//             this.bucketExpr(interval, sql`${valuationEntity.date}`),
//             valuationEntity.id,
//             includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//             isTagGrouping ? boqTagIdExpr : isCostCodeTagPairGrouping ? boqPairCostCodeIdExpr : boqCostCodeIdExpr,
//             isCostCodeTagPairGrouping ? boqPairTagIdExpr : sql`null::uuid`,
//           );
//       })(),
//     );

//     const paymentMetricsCte = db.$with('payment_metrics').as(
//       db
//         .select({
//           bucket: sql<Date>`pmr.bucket`.as('bucket'),
//           projectId: sql<string | null>`pmr.project_id`.as('project_id'),
//           costCodeId: sql<string | null>`pmr.cost_code_id`.as('cost_code_id'),
//           customTagId: sql<string | null>`pmr.custom_tag_id`.as('custom_tag_id'),
//           totalRetentionApplied: sql<number>`sum(pmr.total_retention_applied)`.as('total_retention_applied'),
//           totalRetentionCertified: sql<number>`sum(pmr.total_retention_certified)`.as('total_retention_certified'),
//           previouslyApplied: sql<number>`sum(pmr.previously_applied)`.as('previously_applied'),
//           previouslyCertified: sql<number>`sum(pmr.previously_certified)`.as('previously_certified'),
//           periodAppliedBudget: sql<number>`sum(pmr.period_applied_budget)`.as('period_applied_budget'),
//           periodCertifiedBudget: sql<number>`sum(pmr.period_certified_budget)`.as('period_certified_budget'),
//           periodRetentionApplied: sql<number>`sum(pmr.period_retention_applied)`.as('period_retention_applied'),
//           periodRetentionCertified: sql<number>`sum(pmr.period_retention_certified)`.as('period_retention_certified'),
//           netValuationApplied: sql<number>`sum(pmr.net_valuation_applied)`.as('net_valuation_applied'),
//           netValuationCertified: sql<number>`sum(pmr.net_valuation_certified)`.as('net_valuation_certified'),
//           grossPaymentDueApplied: sql<number>`sum(pmr.gross_payment_due_applied)`.as('gross_payment_due_applied'),
//           grossPaymentDueCertified: sql<number>`sum(pmr.gross_payment_due_certified)`.as('gross_payment_due_certified'),
//           vatPercentage: sql<number>`coalesce(max(pmr.vat_percentage), 0)`.as('vat_percentage'),
//           vatApplied: sql<number>`sum(pmr.vat_applied)`.as('vat_applied'),
//           vatCertified: sql<number>`sum(pmr.vat_certified)`.as('vat_certified'),
//           netPaymentDueApplied: sql<number>`sum(pmr.gross_payment_due_applied + pmr.vat_applied)`.as(
//             'net_payment_due_applied',
//           ),
//           netPaymentDueCertified: sql<number>`sum(pmr.gross_payment_due_certified + pmr.vat_certified)`.as(
//             'net_payment_due_certified',
//           ),
//           netForecastValue: sql<number>`coalesce(max(pmr.net_forecast_value), 0)`.as('net_forecast_value'),
//           netForecastBudget: sql<number>`coalesce(max(pmr.net_forecast_budget), 0)`.as('net_forecast_budget'),
//           paymentApplicationNumber: sql<string>`
//             string_agg(
//               distinct nullif(pmr.payment_application_number, ''),
//               ', ' order by nullif(pmr.payment_application_number, '')
//             )
//           `.as('payment_application_number'),
//         })
//         .from(sql`${paymentMetricsRawCte} pmr`)
//         .groupBy(sql`pmr.bucket`, sql`pmr.project_id`, sql`pmr.cost_code_id`, sql`pmr.custom_tag_id`),
//     );

//     // CTE: universe of cost codes we care about.
//     // - UNION of cost codes that appear in BoQ and in entity_cost_codes (documents and timesheets).
//     // - Always includes NULL to ensure line items without cost codes are included.
//     //   If there are no NULL cost codes in the data, the NULL row won't match anything in joins.
//     // - LEFT JOIN to cost_codes table, so downstream layers can enrich with labels if needed.
//     // NOTE: Tenant-scoped to ensure we only see cost codes for the current tenant.
//     const tenantId = this.tenantId;
//     const costCodesCte = db.$with('cost_code_universe').as(qb =>
//       qb
//         .select({
//           costCodeId: sql<string | null>`u.ccid`.as('cc_cost_code_id'),
//           name: costCodeEntity.name,
//           shortCode: costCodeEntity.shortCode,
//         })
//         .from(
//           sql`
//         (
//           select distinct ${boqLineItemEntity.costCodeId} as ccid
//           from ${boqLineItemEntity}
//           where ${boqLineItemEntity.tenantId} = ${tenantId}
//           and ${projectMatchCondition(boqLineItemEntity.projectId)}
//           union
//           select distinct ${entityCostCodeEntity.costCodeId} as ccid
//           from ${entityCostCodeEntity}
//           where ${entityCostCodeEntity.tenantId} = ${tenantId}
//           and ${projectMatchCondition(entityCostCodeEntity.projectId)}
//           union
//           -- Always include NULL to handle line items without cost code assignments
//           select null as ccid
//         ) as u(ccid)
//       `,
//         )
//         .leftJoin(costCodeEntity, eq(costCodeEntity.id, sql`u.ccid`)),
//     );

//     const customTagsCte = db.$with('cost_code_universe').as(qb =>
//       qb
//         .select({
//           costCodeId: sql<string | null>`u.ccid`.as('cc_cost_code_id'),
//           name: customTagEntity.title,
//           shortCode: sql<string | null>`null`.as('short_code'),
//         })
//         .from(
//           sql`
//         (
//           select distinct ${entityCustomTagEntity.customTagId} as ccid
//           from ${entityCustomTagEntity}
//           where ${entityCustomTagEntity.tenantId} = ${tenantId}
//           and ${projectMatchCondition(entityCustomTagEntity.projectId)}
//           union
//           -- Always include NULL to handle line items without tag assignments
//           select null as ccid
//         ) as u(ccid)
//       `,
//         )
//         .leftJoin(customTagEntity, eq(customTagEntity.id, sql`u.ccid`)),
//     );

//     const dimensionUniverseCte = isTagGrouping ? customTagsCte : costCodesCte;

//     const dominantCustomTagByCostCodeCte = db.$with('cost_code_dominant_tag').as(
//       db.select({
//         costCodeId: sql<string | null>`m.cost_code_id`.as('cost_code_id'),
//         customTagId: sql<string | null>`m.custom_tag_id`.as('custom_tag_id'),
//       }).from(sql`
//           (
//             with tag_cost_code_pairs as (
//               select
//                 ecc.cost_code_id as cost_code_id,
//                 ect.custom_tag_id as custom_tag_id
//               from ${entityCostCodeEntity} ecc
//               inner join ${entityCustomTagEntity} ect
//                 on ecc.document_line_item_id is not distinct from ect.document_line_item_id
//               where ecc.tenant_id = ${this.tenantId}
//                 and ect.tenant_id = ${this.tenantId}
//                 and ecc.document_line_item_id is not null
//                 and ect.document_line_item_id is not null
//                 and ect.custom_tag_id is not null
//                 and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//                 and ${projectMatchConditionExpr(sql`ect.project_id`)}
//               group by ecc.cost_code_id, ect.custom_tag_id

//               union all

//               select
//                 ecc.cost_code_id as cost_code_id,
//                 ect.custom_tag_id as custom_tag_id
//               from ${entityCostCodeEntity} ecc
//               inner join ${entityCustomTagEntity} ect
//                 on ecc.timesheet_line_item_id is not distinct from ect.timesheet_line_item_id
//               where ecc.tenant_id = ${this.tenantId}
//                 and ect.tenant_id = ${this.tenantId}
//                 and ecc.timesheet_line_item_id is not null
//                 and ect.timesheet_line_item_id is not null
//                 and ect.custom_tag_id is not null
//                 and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//                 and ${projectMatchConditionExpr(sql`ect.project_id`)}
//               group by ecc.cost_code_id, ect.custom_tag_id

//               union all

//               select
//                 bli.cost_code_id as cost_code_id,
//                 ect.custom_tag_id as custom_tag_id
//               from ${boqLineItemEntity} bli
//               inner join ${entityCustomTagEntity} ect
//                 on ect.boq_line_item_id = bli.id
//               where bli.tenant_id = ${this.tenantId}
//                 and ect.tenant_id = ${this.tenantId}
//                 and ect.custom_tag_id is not null
//                 and bli.type = ${BoqLineItemTypeEnum.LINE_ITEM}
//                 and bli.boq_doc_type = ${BoqDocTypeEnum.BOQ}
//                 and ${projectMatchConditionExpr(sql`bli.project_id`)}
//                 and ${projectMatchConditionExpr(sql`ect.project_id`)}
//               group by bli.cost_code_id, ect.custom_tag_id

//               union all

//               select
//                 bli.cost_code_id as cost_code_id,
//                 bli.custom_tag_id as custom_tag_id
//               from ${boqLineItemEntity} bli
//               where bli.tenant_id = ${this.tenantId}
//                 and bli.custom_tag_id is not null
//                 and bli.type = ${BoqLineItemTypeEnum.LINE_ITEM}
//                 and bli.boq_doc_type = ${BoqDocTypeEnum.BOQ}
//                 and ${projectMatchConditionExpr(sql`bli.project_id`)}
//               group by bli.cost_code_id, bli.custom_tag_id

//               union all

//               -- Document line item cost codes joined to document-level tags
//               -- (covers the case where a tag is assigned to the whole document,
//               --  not to the individual line item)
//               select
//                 ecc.cost_code_id as cost_code_id,
//                 ect.custom_tag_id as custom_tag_id
//               from ${entityCostCodeEntity} ecc
//               inner join ${documentLineItemEntity} dli on dli.id = ecc.document_line_item_id
//               inner join ${entityCustomTagEntity} ect
//                 on ect.document_id = dli.document_id
//                 and ect.document_line_item_id is null
//               where ecc.tenant_id = ${this.tenantId}
//                 and ect.tenant_id = ${this.tenantId}
//                 and ecc.document_line_item_id is not null
//                 and ect.custom_tag_id is not null
//                 and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//                 and ${projectMatchConditionExpr(sql`ect.project_id`)}
//               group by ecc.cost_code_id, ect.custom_tag_id

//               union all

//               -- Timesheet line item cost codes joined to timesheet-level tags
//               -- (covers the case where a tag is assigned to the whole timesheet,
//               --  not to the individual timesheet line item)
//               select
//                 ecc.cost_code_id as cost_code_id,
//                 ect.custom_tag_id as custom_tag_id
//               from ${entityCostCodeEntity} ecc
//               inner join ${timesheetLineItemEntity} tsli on tsli.id = ecc.timesheet_line_item_id
//               inner join ${entityCustomTagEntity} ect
//                 on ect.timesheet_id = tsli.timesheet_id
//                 and ect.timesheet_line_item_id is null
//               where ecc.tenant_id = ${this.tenantId}
//                 and ect.tenant_id = ${this.tenantId}
//                 and ecc.timesheet_line_item_id is not null
//                 and ect.custom_tag_id is not null
//                 and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//                 and ${projectMatchConditionExpr(sql`ect.project_id`)}
//               group by ecc.cost_code_id, ect.custom_tag_id
//             )
//             select
//               cost_code_id,
//               ${isTagGrouping ? sql`custom_tag_id` : sql`min(custom_tag_id::text)::uuid`} as custom_tag_id
//             from tag_cost_code_pairs
//             group by cost_code_id${isTagGrouping ? sql`, custom_tag_id` : sql``}
//           ) m
//         `),
//     );

//     const costCodeTagUniverseCte = db.$with('cost_code_tag_universe').as(
//       db.select({
//         costCodeId: sql<string | null>`p.cost_code_id`.as('cost_code_id'),
//         customTagId: sql<string | null>`p.custom_tag_id`.as('custom_tag_id'),
//       }).from(sql`
//           (
//             select distinct
//               ecc.cost_code_id as cost_code_id,
//               ect.custom_tag_id as custom_tag_id
//             from ${documentLineItemEntity} dli
//             inner join ${documentEntity} d on d.id = dli.document_id
//             left join ${entityCostCodeEntity} ecc
//               on ecc.document_line_item_id = dli.id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             left join ${entityCustomTagEntity} ect
//               on ect.document_line_item_id = dli.id
//               and ect.tenant_id = ${this.tenantId}
//               and ect.custom_tag_id is not null
//               and ${projectMatchConditionExpr(sql`ect.project_id`)}
//             ${isProjectFiltered ? sql`inner join ${documentProjectEntity} on ${documentProjectEntity.documentId} = d.id` : sql``}
//             where d.tenant_id = ${this.tenantId}
//               and dli.tenant_id = ${this.tenantId}
//               and d.status in (${sql.join(this.defaultDocumentStatuses, sql`,`)})
//               and d.issue_date is not null
//               and d.issue_date >= ${from}
//               and d.issue_date <= ${to}
//               and (${projectMatchColExpr(sql`dli.project_id`)} or dli.project_id is null)
//               and ${isProjectFiltered ? projectMatchCol(documentProjectEntity.projectId) : sql`true`}

//             union

//             select distinct
//               ecc.cost_code_id as cost_code_id,
//               ect.custom_tag_id as custom_tag_id
//             from ${timesheetLineItemEntity} tli
//             inner join ${timesheetEntity} t on t.id = tli.timesheet_id
//             ${isProjectFiltered ? sql`inner join ${timesheetProjectEntity} tp on tp.timesheet_id = t.id` : sql``}
//             left join ${entityCostCodeEntity} ecc
//               on ecc.timesheet_line_item_id = tli.id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             left join ${entityCustomTagEntity} ect
//               on ect.timesheet_line_item_id = tli.id
//               and ect.tenant_id = ${this.tenantId}
//               and ect.custom_tag_id is not null
//               and ${projectMatchConditionExpr(sql`ect.project_id`)}
//             where t.tenant_id = ${this.tenantId}
//               and tli.tenant_id = ${this.tenantId}
//               and t.status = ${EntityStatusEnum.APPROVED}
//               and tli.date is not null
//               and t.start_of_week >= ${from}
//               and t.start_of_week <= ${to}
//               and (${projectMatchColExpr(sql`tli.project_id`)} or tli.project_id is null)
//               and ${isProjectFiltered ? projectMatchColExpr(sql`tp.project_id`) : sql`true`}

//             union

//             select distinct
//               coalesce(ecc.cost_code_id, bli.cost_code_id) as cost_code_id,
//               ect.custom_tag_id as custom_tag_id
//             from ${boqLineItemEntity} bli
//             inner join ${entityCustomTagEntity} ect
//               on ect.boq_line_item_id = bli.id
//               and ect.tenant_id = ${this.tenantId}
//               and ect.custom_tag_id is not null
//               and ${projectMatchConditionExpr(sql`ect.project_id`)}
//             left join ${entityCostCodeEntity} ecc
//               on ecc.id = ect.entity_cost_code_id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             where bli.tenant_id = ${this.tenantId}
//               and bli.type = ${BoqLineItemTypeEnum.LINE_ITEM}
//               and bli.boq_doc_type = ${BoqDocTypeEnum.BOQ}
//               and ${projectMatchConditionExpr(sql`bli.project_id`)}

//             union

//             select distinct
//               bli.cost_code_id as cost_code_id,
//               bli.custom_tag_id as custom_tag_id
//             from ${boqLineItemEntity} bli
//             where bli.tenant_id = ${this.tenantId}
//               and bli.custom_tag_id is not null
//               and bli.type = ${BoqLineItemTypeEnum.LINE_ITEM}
//               and bli.boq_doc_type = ${BoqDocTypeEnum.BOQ}
//               and ${projectMatchConditionExpr(sql`bli.project_id`)}

//             union

//             select distinct
//               coalesce(ecc.cost_code_id, bli.cost_code_id) as cost_code_id,
//               null::uuid as custom_tag_id
//             from ${boqLineItemEntity} bli
//             left join ${entityCostCodeEntity} ecc
//               on ecc.boq_line_item_id = bli.id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             where bli.tenant_id = ${this.tenantId}
//               and bli.type = ${BoqLineItemTypeEnum.LINE_ITEM}
//               and bli.boq_doc_type = ${BoqDocTypeEnum.BOQ}
//               and coalesce(ecc.cost_code_id, bli.cost_code_id) is not null
//               and (
//                 (
//                   ecc.id is not null
//                   and not exists (
//                     select 1
//                     from ${entityCustomTagEntity} ect2
//                     where ect2.boq_line_item_id = bli.id
//                       and ect2.tenant_id = ${this.tenantId}
//                       and ect2.entity_cost_code_id = ecc.id
//                       and ect2.custom_tag_id is not null
//                       and ${projectMatchConditionExpr(sql`ect2.project_id`)}
//                   )
//                 )
//                 or (
//                   ecc.id is null
//                   and bli.custom_tag_id is null
//                   and not exists (
//                     select 1
//                     from ${entityCustomTagEntity} ect2
//                     where ect2.boq_line_item_id = bli.id
//                       and ect2.tenant_id = ${this.tenantId}
//                       and ect2.custom_tag_id is not null
//                       and ${projectMatchConditionExpr(sql`ect2.project_id`)}
//                   )
//                 )
//               )
//               and ${projectMatchConditionExpr(sql`bli.project_id`)}

//             union

//             select distinct
//               null::uuid as cost_code_id,
//               ect.custom_tag_id as custom_tag_id
//             from ${documentLineItemEntity} dli
//             inner join ${documentEntity} d on d.id = dli.document_id
//             inner join ${entityCustomTagEntity} ect
//               on ect.document_id = dli.document_id
//               and ect.document_line_item_id is null
//               and ect.tenant_id = ${this.tenantId}
//               and ect.custom_tag_id is not null
//               and ${projectMatchConditionExpr(sql`ect.project_id`)}
//             left join ${entityCostCodeEntity} ecc
//               on ecc.document_line_item_id = dli.id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             ${isProjectFiltered ? sql`inner join ${documentProjectEntity} on ${documentProjectEntity.documentId} = d.id` : sql``}
//             where d.tenant_id = ${this.tenantId}
//               and dli.tenant_id = ${this.tenantId}
//               and d.status in (${sql.join(this.defaultDocumentStatuses, sql`,`)})
//               and d.issue_date is not null
//               and d.issue_date >= ${from}
//               and d.issue_date <= ${to}
//               and (${projectMatchColExpr(sql`dli.project_id`)} or dli.project_id is null)
//               and ${isProjectFiltered ? projectMatchCol(documentProjectEntity.projectId) : sql`true`}
//               and ecc.document_line_item_id is null

//             union

//             select distinct
//               null::uuid as cost_code_id,
//               ect.custom_tag_id as custom_tag_id
//             from ${timesheetLineItemEntity} tli
//             inner join ${timesheetEntity} t on t.id = tli.timesheet_id
//             ${isProjectFiltered ? sql`inner join ${timesheetProjectEntity} tp on tp.timesheet_id = t.id` : sql``}
//             inner join ${entityCustomTagEntity} ect
//               on ect.timesheet_id = tli.timesheet_id
//               and ect.timesheet_line_item_id is null
//               and ect.tenant_id = ${this.tenantId}
//               and ect.custom_tag_id is not null
//               and ${projectMatchConditionExpr(sql`ect.project_id`)}
//             left join ${entityCostCodeEntity} ecc
//               on ecc.timesheet_line_item_id = tli.id
//               and ecc.tenant_id = ${this.tenantId}
//               and ${projectMatchConditionExpr(sql`ecc.project_id`)}
//             where t.tenant_id = ${this.tenantId}
//               and tli.tenant_id = ${this.tenantId}
//               and t.status = ${EntityStatusEnum.APPROVED}
//               and tli.date is not null
//               and t.start_of_week >= ${from}
//               and t.start_of_week <= ${to}
//               and (${projectMatchColExpr(sql`tli.project_id`)} or tli.project_id is null)
//               and ${isProjectFiltered ? projectMatchColExpr(sql`tp.project_id`) : sql`true`}
//               and ecc.timesheet_line_item_id is null

//             union

//             select null::uuid as cost_code_id, null::uuid as custom_tag_id
//           ) p
//         `),
//     );

//     // CTE: base grid = all (bucket, costCodeId) combinations.
//     // This is effectively buckets × cost_codes via a cross-join,
//     // giving us a full matrix so that missing data can still show as 0.
//     const baseCte = db.$with('base').as(qb => {
//       if (pairByCostCodeTag && !isTagGrouping) {
//         return qb
//           .select({
//             bBucket: sql<Date>`b.bucket`.as('b_bucket'),
//             bProjectId: sql<string | null>`pu.project_id`.as('b_project_id'),
//             bProjectName: sql<string | null>`pu.project_name`.as('b_project_name'),
//             bProjectStartDate: sql<Date | null>`pu.project_start_date`.as('b_project_start_date'),
//             bProjectTargetDate: sql<Date | null>`pu.project_target_date`.as('b_project_target_date'),
//             bProjectTotalWeeks: sql<number>`pu.total_weeks`.as('b_project_total_weeks'),
//             bCostCodeId: sql<string | null>`p.cost_code_id`.as('b_cost_code_id'),
//             bCustomTagId: sql<string | null>`p.custom_tag_id`.as('b_custom_tag_id'),
//           })
//           .from(sql`${bucketsCte} b`)
//           .innerJoin(sql`${projectUniverseCte} pu`, sql`true`)
//           .innerJoin(sql`${costCodeTagUniverseCte} p`, sql`true`);
//       }

//       return qb
//         .select({
//           bBucket: sql<Date>`b.bucket`.as('b_bucket'),
//           bProjectId: sql<string | null>`pu.project_id`.as('b_project_id'),
//           bProjectName: sql<string | null>`pu.project_name`.as('b_project_name'),
//           bProjectStartDate: sql<Date | null>`pu.project_start_date`.as('b_project_start_date'),
//           bProjectTargetDate: sql<Date | null>`pu.project_target_date`.as('b_project_target_date'),
//           bProjectTotalWeeks: sql<number>`pu.total_weeks`.as('b_project_total_weeks'),
//           bCostCodeId: sql<string | null>`c.cc_cost_code_id`.as('b_cost_code_id'),
//         })
//         .from(sql`${bucketsCte} b`)
//         .innerJoin(sql`${projectUniverseCte} pu`, sql`true`)
//         .innerJoin(sql`${dimensionUniverseCte} c`, sql`true`);
//     });

//     const boqOriginalStaticCte = db.$with('boq_original_static').as(
//       (() => {
//         if (pairByCostCodeTag && !isTagGrouping) {
//           return db
//             .select({
//               projectId: includeProjectDimension
//                 ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                 : sql<string | null>`null::uuid`.as('project_id'),
//               costCodeId: sql<string | null>`${boqPairCostCodeIdExpr}`.as('cost_code_id'),
//               customTagId: sql<string | null>`${boqPairTagIdExpr}`.as('custom_tag_id'),
//               originalValue: sql<number>`sum(${boqLineItemEntity.tenderValue} * ${boqPairSellRatioExpr})`.as(
//                 'original_value',
//               ),
//               originalBudget: sql<number>`sum(${boqLineItemEntity.tenderBudget} * ${boqPairCostRatioExpr})`.as(
//                 'original_budget',
//               ),
//             })
//             .from(boqLineItemEntity)
//             .leftJoin(boqPairTagAllocCte, eq(boqPairTagAllocCte.boqLineItemId, boqLineItemEntity.id))
//             .where(
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   ...projectFilter,
//                   type: { eq: BoqLineItemTypeEnum.LINE_ITEM },
//                   boqDocType: { eq: BoqDocTypeEnum.BOQ },
//                 }),
//                 table: boqLineItemEntity,
//               }),
//             )
//             .groupBy(
//               includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`,
//               boqPairCostCodeIdExpr,
//               boqPairTagIdExpr,
//             );
//         }

//         if (isTagGrouping) {
//           return db
//             .select({
//               projectId: includeProjectDimension
//                 ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//                 : sql<string | null>`null::uuid`.as('project_id'),
//               costCodeId: sql<string | null>`${boqTagIdExpr}`.as('cost_code_id'),
//               customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//               originalValue: sql<number>`sum(${boqLineItemEntity.tenderValue} * ${boqTagSellRatioExpr})`.as(
//                 'original_value',
//               ),
//               originalBudget: sql<number>`sum(${boqLineItemEntity.tenderBudget} * ${boqTagCostRatioExpr})`.as(
//                 'original_budget',
//               ),
//             })
//             .from(boqLineItemEntity)
//             .leftJoin(boqAllocCte, eq(boqAllocCte.boqLineItemId, boqLineItemEntity.id))
//             .where(
//               this.mapFilterToQuery({
//                 filter: this.withTenant({
//                   ...projectFilter,
//                   type: { eq: BoqLineItemTypeEnum.LINE_ITEM },
//                   boqDocType: { eq: BoqDocTypeEnum.BOQ },
//                 }),
//                 table: boqLineItemEntity,
//               }),
//             )
//             .groupBy(includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`, boqTagIdExpr);
//         }

//         return db
//           .select({
//             projectId: includeProjectDimension
//               ? sql<string | null>`${boqLineItemEntity.projectId}`.as('project_id')
//               : sql<string | null>`null::uuid`.as('project_id'),
//             costCodeId: sql<string | null>`${boqCostCodeIdExpr}`.as('cost_code_id'),
//             customTagId: sql<string | null>`null::uuid`.as('custom_tag_id'),
//             originalValue: sql<number>`sum(${boqLineItemEntity.tenderValue} * ${boqCostSellRatioExpr})`.as(
//               'original_value',
//             ),
//             originalBudget: sql<number>`sum(${boqLineItemEntity.tenderBudget} * ${boqCostRatioExpr})`.as(
//               'original_budget',
//             ),
//           })
//           .from(boqLineItemEntity)
//           .leftJoin(boqCostCodeAllocCte, eq(boqCostCodeAllocCte.boqLineItemId, boqLineItemEntity.id))
//           .where(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 type: { eq: BoqLineItemTypeEnum.LINE_ITEM },
//                 boqDocType: { eq: BoqDocTypeEnum.BOQ },
//               }),
//               table: boqLineItemEntity,
//             }),
//           )
//           .groupBy(includeProjectDimension ? boqLineItemEntity.projectId : sql`null::uuid`, boqCostCodeIdExpr);
//       })(),
//     );

//     // CTE: the final joined per (bucket, costCodeId) row, with all base values coalesced to 0.
//     // This keeps downstream pivots simple: there is always exactly one row per
//     // bucket/costCode combination, even when there were no actuals/valuations.
//     const joinedCte = db.$with('joined').as(qb =>
//       qb
//         .select({
//           bucket: sql<Date>`b.b_bucket`.as('bucket'),
//           projectId: sql<string | null>`b.b_project_id`.as('project_id'),
//           projectName: sql<string | null>`b.b_project_name`.as('project_name'),
//           costCodeId: sql<string | null>`b.b_cost_code_id`.as('cost_code_id'),
//           customTagId: isTagGrouping
//             ? sql<string | null>`b.b_cost_code_id`.as('custom_tag_id')
//             : pairByCostCodeTag
//               ? sql<string | null>`b.b_custom_tag_id`.as('custom_tag_id')
//               : sql<string | null>`dt.custom_tag_id`.as('custom_tag_id'),
//           projectStartDate: sql<Date | null>`b.b_project_start_date`.as('project_start_date'),
//           projectTargetDate: sql<Date | null>`b.b_project_target_date`.as('project_target_date'),
//           totalWeeks: sql<number>`coalesce(b.b_project_total_weeks, 0)`.as('total_weeks'),
//           contractValue: sql<number>`coalesce(bs.contract_value, 0)`.as('contract_value'),
//           contractBudget: sql<number>`coalesce(bs.contract_budget, 0)`.as('contract_budget'),
//           actualCosts: sql<number>`coalesce(ac.value, 0)`.as('actual_costs'),
//           actualSales: sql<number>`coalesce(asales.value, 0)`.as('actual_sales'),
//           appliedValue: sql<number>`coalesce(av.value, 0)`.as('applied_value'),
//           appliedBudget: sql<number>`coalesce(ab.value, 0)`.as('applied_budget'),
//           certifiedValue: sql<number>`coalesce(cv.value, 0)`.as('certified_value'),
//           certifiedBudget: sql<number>`coalesce(cb.value, 0)`.as('certified_budget'),
//           periodApplied: sql<number>`coalesce(pa.value, 0)`.as('period_applied'),
//           periodCertified: sql<number>`coalesce(pc.value, 0)`.as('period_certified'),
//           originalValue: sql<number>`coalesce(bos.original_value, 0)`.as('original_value'),
//           originalBudget: sql<number>`coalesce(bos.original_budget, 0)`.as('original_budget'),
//           totalRetentionApplied: sql<number>`coalesce(pm.total_retention_applied, 0)`.as('total_retention_applied'),
//           totalRetentionCertified: sql<number>`coalesce(pm.total_retention_certified, 0)`.as(
//             'total_retention_certified',
//           ),
//           previouslyApplied: sql<number>`coalesce(pm.previously_applied, 0)`.as('previously_applied'),
//           previouslyCertified: sql<number>`coalesce(pm.previously_certified, 0)`.as('previously_certified'),
//           periodAppliedBudget: sql<number>`coalesce(pm.period_applied_budget, 0)`.as('period_applied_budget'),
//           periodCertifiedBudget: sql<number>`coalesce(pm.period_certified_budget, 0)`.as('period_certified_budget'),
//           periodRetentionApplied: sql<number>`coalesce(pm.period_retention_applied, 0)`.as('period_retention_applied'),
//           periodRetentionCertified: sql<number>`coalesce(pm.period_retention_certified, 0)`.as(
//             'period_retention_certified',
//           ),
//           vatPercentage: sql<number>`coalesce(pm.vat_percentage, 0)`.as('vat_percentage'),
//           netValuationApplied: sql<number>`coalesce(pm.net_valuation_applied, 0)`.as('net_valuation_applied'),
//           netValuationCertified: sql<number>`coalesce(pm.net_valuation_certified, 0)`.as('net_valuation_certified'),
//           grossPaymentDueApplied: sql<number>`coalesce(pm.gross_payment_due_applied, 0)`.as(
//             'gross_payment_due_applied',
//           ),
//           grossPaymentDueCertified: sql<number>`coalesce(pm.gross_payment_due_certified, 0)`.as(
//             'gross_payment_due_certified',
//           ),
//           vatApplied: sql<number>`coalesce(pm.vat_applied, 0)`.as('vat_applied'),
//           vatCertified: sql<number>`coalesce(pm.vat_certified, 0)`.as('vat_certified'),
//           netPaymentDueApplied: sql<number>`coalesce(pm.net_payment_due_applied, 0)`.as('net_payment_due_applied'),
//           netPaymentDueCertified: sql<number>`coalesce(pm.net_payment_due_certified, 0)`.as(
//             'net_payment_due_certified',
//           ),
//           netForecastValue: sql<number>`coalesce(pm.net_forecast_value, 0)`.as('net_forecast_value'),
//           netForecastBudget: sql<number>`coalesce(pm.net_forecast_budget, 0)`.as('net_forecast_budget'),
//           paymentApplicationNumber: sql<string>`coalesce(pm.payment_application_number, '')`.as(
//             'payment_application_number',
//           ),
//         })
//         .from(sql`${baseCte} b`)
//         .leftJoin(
//           sql`${boqStaticCte} bs`,
//           pairByCostCodeTag && !isTagGrouping
//             ? sql`bs.project_id IS NOT DISTINCT FROM b.b_project_id and bs.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and bs.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id`
//             : sql`bs.project_id IS NOT DISTINCT FROM b.b_project_id and bs.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id`,
//         )
//         .leftJoin(
//           sql`${dominantCustomTagByCostCodeCte} dt`,
//           !isTagGrouping && !pairByCostCodeTag
//             ? sql`dt.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id`
//             : sql`false`,
//         )
//         .leftJoin(
//           sql`${actualCostCte} ac`,
//           pairByCostCodeTag && !isTagGrouping
//             ? sql`ac.project_id IS NOT DISTINCT FROM b.b_project_id and ac.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and ac.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and ac.bucket = b.b_bucket`
//             : sql`ac.project_id IS NOT DISTINCT FROM b.b_project_id and ac.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and ac.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${boqOriginalStaticCte} bos`,
//           pairByCostCodeTag && !isTagGrouping
//             ? sql`bos.project_id IS NOT DISTINCT FROM b.b_project_id and bos.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and bos.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id`
//             : sql`bos.project_id IS NOT DISTINCT FROM b.b_project_id and bos.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id`,
//         )
//         .leftJoin(
//           sql`${actualSalesCte} asales`,
//           pairByCostCodeTag && !isTagGrouping
//             ? sql`asales.project_id IS NOT DISTINCT FROM b.b_project_id and asales.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and asales.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and asales.bucket = b.b_bucket`
//             : sql`asales.project_id IS NOT DISTINCT FROM b.b_project_id and asales.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and asales.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${appliedValueCte} av`,
//           isCostCodeTagPairGrouping
//             ? sql`av.project_id IS NOT DISTINCT FROM b.b_project_id and av.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and av.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and av.bucket = b.b_bucket`
//             : sql`av.project_id IS NOT DISTINCT FROM b.b_project_id and av.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and av.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${appliedBudgetCte} ab`,
//           isCostCodeTagPairGrouping
//             ? sql`ab.project_id IS NOT DISTINCT FROM b.b_project_id and ab.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and ab.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and ab.bucket = b.b_bucket`
//             : sql`ab.project_id IS NOT DISTINCT FROM b.b_project_id and ab.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and ab.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${certifiedValueCte} cv`,
//           isCostCodeTagPairGrouping
//             ? sql`cv.project_id IS NOT DISTINCT FROM b.b_project_id and cv.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and cv.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and cv.bucket = b.b_bucket`
//             : sql`cv.project_id IS NOT DISTINCT FROM b.b_project_id and cv.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and cv.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${certifiedBudgetCte} cb`,
//           isCostCodeTagPairGrouping
//             ? sql`cb.project_id IS NOT DISTINCT FROM b.b_project_id and cb.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and cb.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and cb.bucket = b.b_bucket`
//             : sql`cb.project_id IS NOT DISTINCT FROM b.b_project_id and cb.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and cb.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${periodAppliedCte} pa`,
//           isCostCodeTagPairGrouping
//             ? sql`pa.project_id IS NOT DISTINCT FROM b.b_project_id and pa.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pa.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and pa.bucket = b.b_bucket`
//             : sql`pa.project_id IS NOT DISTINCT FROM b.b_project_id and pa.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pa.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${periodCertifiedCte} pc`,
//           isCostCodeTagPairGrouping
//             ? sql`pc.project_id IS NOT DISTINCT FROM b.b_project_id and pc.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pc.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and pc.bucket = b.b_bucket`
//             : sql`pc.project_id IS NOT DISTINCT FROM b.b_project_id and pc.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pc.bucket = b.b_bucket`,
//         )
//         .leftJoin(
//           sql`${paymentMetricsCte} pm`,
//           isCostCodeTagPairGrouping
//             ? sql`pm.project_id IS NOT DISTINCT FROM b.b_project_id and pm.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pm.custom_tag_id IS NOT DISTINCT FROM b.b_custom_tag_id and pm.bucket = b.b_bucket`
//             : sql`pm.project_id IS NOT DISTINCT FROM b.b_project_id and pm.cost_code_id IS NOT DISTINCT FROM b.b_cost_code_id and pm.bucket = b.b_bucket`,
//         ),
//     );

//     // Final SELECT: add all derived margins / variance metrics on top of joinedCte.
//     // These are computed in SQL, so the JS layer only has to consume numbers.
//     const weeksElapsedExpr = sql<number>`
//       case
//         when ${joinedCte.totalWeeks} = 0 or ${joinedCte.projectStartDate} is null then 0
//         else greatest(
//           0,
//           least(
//             ${joinedCte.totalWeeks},
//             floor(extract(epoch from (current_date::timestamp - ${joinedCte.projectStartDate}::timestamp))
//               / ${60 * 60 * 24 * 7})::int
//           )
//         )
//       end
//     `;

//     const cumulativePartitionExpr = pairByCostCodeTag
//       ? sql`${joinedCte.projectId}, ${joinedCte.costCodeId}, ${joinedCte.customTagId}`
//       : sql`${joinedCte.projectId}, ${joinedCte.costCodeId}`;

//     // Do not drop zero-valued bucket rows here.
//     // Cumulative metrics rely on those intermediate buckets remaining in the result set
//     // so values can carry forward across months with no direct activity.

//     const baseQuery = db
//       .with(
//         ...(isTagGrouping ? [boqAllocCte] : []),
//         ...(!isTagGrouping && !pairByCostCodeTag ? [boqCostCodeAllocCte] : []),
//         ...(pairByCostCodeTag && !isTagGrouping ? [boqPairTagAllocCte] : []),
//         bucketsCte,
//         boqStaticCte,
//         docAllocCte,
//         ...(pairByCostCodeTag ? [docTagAllocCte] : []),
//         timesheetAllocCte,
//         ...(pairByCostCodeTag ? [timesheetTagAllocCte] : []),
//         documentActualCte,
//         timesheetActualCte,
//         actualCostCte,
//         actualSalesCte,
//         appliedValueCte,
//         appliedBudgetCte,
//         certifiedValueCte,
//         certifiedBudgetCte,
//         periodAppliedCte,
//         periodCertifiedCte,
//         projectUniverseCte,
//         dimensionUniverseCte,
//         ...(pairByCostCodeTag && !isTagGrouping ? [costCodeTagUniverseCte] : []),
//         dominantCustomTagByCostCodeCte,
//         paymentMetricsRawCte,
//         paymentMetricsCte,
//         baseCte,
//         boqOriginalStaticCte,
//         joinedCte,
//       )
//       .select({
//         projectId: joinedCte.projectId,
//         projectName: joinedCte.projectName,
//         costCodeId: joinedCte.costCodeId,
//         customTagId: joinedCte.customTagId,
//         costCodeName: sql<string | null>`${costCodeEntity.name}`.as('cost_code_name'),
//         customTagName: sql<string | null>`${customTagEntity.title}`.as('custom_tag_name'),
//         bucket: joinedCte.bucket,
//         projectStartDate: sql<string>`
//           case
//             when ${joinedCte.costCodeId} is null then coalesce(to_char(${joinedCte.projectStartDate}, 'YYYY-MM-DD'), '')
//             else ''
//           end
//         `,
//         projectTargetDate: sql<string>`
//           case
//             when ${joinedCte.costCodeId} is null then coalesce(to_char(${joinedCte.projectTargetDate}, 'YYYY-MM-DD'), '')
//             else ''
//           end
//         `,
//         totalWeeks: sql<number>`
//           case
//             when ${joinedCte.costCodeId} is null then ${joinedCte.totalWeeks}
//             else 0
//           end
//         `,
//         weeksElapsed: sql<number>`
//           case
//             when ${joinedCte.costCodeId} is null then ${weeksElapsedExpr}
//             else 0
//           end
//         `,
//         timeProgressPct: sql<number>`
//           case
//             when ${joinedCte.costCodeId} is not null then 0.0
//             when ${joinedCte.totalWeeks} = 0 then null
//             else (${weeksElapsedExpr}::double precision / nullif(${joinedCte.totalWeeks}, 0)::double precision)
//           end
//         `,
//         contractValue: joinedCte.contractValue,
//         contractBudget: joinedCte.contractBudget,
//         // Contract margin and margin %
//         contractMargin: sql<number>`(${joinedCte.contractValue} - ${joinedCte.contractBudget})`,
//         contractMarginPct: sql<number>`
//         case when ${joinedCte.contractValue} = 0 then null
//              else (${joinedCte.contractValue} - ${joinedCte.contractBudget}) / ${joinedCte.contractValue} end`,
//         actualCosts: joinedCte.actualCosts,
//         actualSales: joinedCte.actualSales,
//         appliedValue: joinedCte.appliedValue,
//         appliedBudget: joinedCte.appliedBudget,
//         certifiedValue: joinedCte.certifiedValue,
//         certifiedBudget: joinedCte.certifiedBudget,
//         originalValue: joinedCte.originalValue,
//         originalBudget: joinedCte.originalBudget,
//         originalMargin: sql<number>`(${joinedCte.originalValue} - ${joinedCte.originalBudget})`,
//         originalMarginPct: sql<number>`
//            case when ${joinedCte.originalValue} = 0 then null
//              else (${joinedCte.originalValue} - ${joinedCte.originalBudget}) / ${joinedCte.originalValue} end`,
//         totalValuationAppliedCumulative: sql<number>`
//         sum(${joinedCte.periodApplied}) over (
//           partition by ${cumulativePartitionExpr}
//           order by ${joinedCte.bucket}
//           rows between unbounded preceding and current row
//         )`,
//         totalBudgetAppliedCumulative: sql<number>`
//         sum(${joinedCte.periodAppliedBudget}) over (
//           partition by ${cumulativePartitionExpr}
//           order by ${joinedCte.bucket}
//           rows between unbounded preceding and current row
//         )`,
//         totalValuationCertifiedCumulative: sql<number>`
//         sum(${joinedCte.periodCertified}) over (
//           partition by ${cumulativePartitionExpr}
//           order by ${joinedCte.bucket}
//           rows between unbounded preceding and current row
//         )`,
//         totalBudgetCertifiedCumulative: sql<number>`
//         sum(${joinedCte.periodCertifiedBudget}) over (
//           partition by ${cumulativePartitionExpr}
//           order by ${joinedCte.bucket}
//           rows between unbounded preceding and current row
//         )`,
//         totalRetentionApplied: joinedCte.totalRetentionApplied,
//         totalRetentionCertified: joinedCte.totalRetentionCertified,
//         previouslyApplied: joinedCte.previouslyApplied,
//         previouslyCertified: joinedCte.previouslyCertified,
//         paymentApplicationNumber: joinedCte.paymentApplicationNumber,
//         periodAppliedBudget: joinedCte.periodAppliedBudget,
//         periodCertifiedBudget: joinedCte.periodCertifiedBudget,
//         periodRetentionApplied: joinedCte.periodRetentionApplied,
//         periodRetentionCertified: joinedCte.periodRetentionCertified,
//         netForecastValue: joinedCte.netForecastValue,
//         netForecastBudget: joinedCte.netForecastBudget,
//         // Applied margin and margin % (applied value vs applied budget)
//         // Formula: Applied Value - Applied Budget
//         appliedMargin: sql<number>`(${joinedCte.appliedValue} - ${joinedCte.appliedBudget})`,
//         // Formula: Applied Margin / Applied Value
//         appliedMarginPct: sql<number>`
//         case when ${joinedCte.appliedValue} = 0 then null
//              else (${joinedCte.appliedValue} - ${joinedCte.appliedBudget}) / ${joinedCte.appliedValue} end`,

//         // Applied Value - Actual Costs
//         // The total value applied for on line items connected to this cost code minus the actual costs allocated to this cost code
//         appliedValueMinusActualCosts: sql<number>`(${joinedCte.appliedValue} - ${joinedCte.actualCosts})`,
//         appliedValueMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.appliedValue} = 0 then null
//              else (${joinedCte.appliedValue} - ${joinedCte.actualCosts}) / ${joinedCte.appliedValue} end`,

//         // Certified margin and margin % (certified value vs certified budget)
//         // Formula: Certified Value - Certified Budget
//         certifiedMargin: sql<number>`(${joinedCte.certifiedValue} - ${joinedCte.certifiedBudget})`,
//         // Formula: Certified Margin / Certified Value
//         certifiedMarginPct: sql<number>`
//         case when ${joinedCte.certifiedValue} = 0 then null
//              else (${joinedCte.certifiedValue} - ${joinedCte.certifiedBudget}) / ${joinedCte.certifiedValue} end`,

//         // Certified Value - Actual Costs
//         // The total value certified for on line items connected to this cost code minus the actual costs allocated to this cost code
//         certifiedValueMinusActualCosts: sql<number>`(${joinedCte.certifiedValue} - ${joinedCte.actualCosts})`,
//         certifiedValueMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.certifiedValue} = 0 then null
//              else (${joinedCte.certifiedValue} - ${joinedCte.actualCosts}) / ${joinedCte.certifiedValue} end`,

//         // Over/under against applied budget
//         actualsMinusAppliedBudget: sql<number>`(${joinedCte.actualCosts} - ${joinedCte.appliedBudget})`,
//         actualsMinusAppliedBudgetPct: sql<number>`
//         case when ${joinedCte.appliedBudget} = 0 then null
//              else (${joinedCte.actualCosts} - ${joinedCte.appliedBudget}) / ${joinedCte.appliedBudget} end`,

//         // Actual Costs - Applied Budget
//         actualCostsMinusAppliedBudget: sql<number>`(${joinedCte.actualCosts} - ${joinedCte.appliedBudget})`,
//         // Applied Budget - Actual Costs (%)
//         appliedBudgetMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.appliedBudget} = 0 then null
//              else (${joinedCte.appliedBudget} - ${joinedCte.actualCosts}) / ${joinedCte.appliedBudget} end`,

//         // Over/under against certified budget
//         actualsMinusCertifiedBudget: sql<number>`(${joinedCte.actualCosts} - ${joinedCte.certifiedBudget})`,
//         actualsMinusCertifiedBudgetPct: sql<number>`
//         case when ${joinedCte.certifiedBudget} = 0 then null
//              else (${joinedCte.actualCosts} - ${joinedCte.certifiedBudget}) / ${joinedCte.certifiedBudget} end`,

//         // Actual Costs - Certified Budget
//         actualCostsMinusCertifiedBudget: sql<number>`(${joinedCte.actualCosts} - ${joinedCte.certifiedBudget})`,

//         // Applied Budget Utilisation %
//         // Formula: (Actual Costs - Applied Budget) / Applied Budget
//         // Note: Returns decimal (e.g., 0.2333 for 23.33%), frontend formatter handles * PERCENTAGE_DIVISOR
//         appliedBudgetUtilisationPct: sql<number>`
//         case when ${joinedCte.appliedBudget} = 0 then null
//              else (${joinedCte.actualCosts} - ${joinedCte.appliedBudget}) / ${joinedCte.appliedBudget}
//         end`,

//         // Certified Budget Utilisation %
//         // Formula: (Actual Costs - Certified Budget) / Certified Budget
//         // Note: Returns decimal (e.g., 0.2333 for 23.33%), frontend formatter handles * PERCENTAGE_DIVISOR
//         certifiedBudgetUtilisationPct: sql<number>`
//         case when ${joinedCte.certifiedBudget} = 0 then null
//              else (${joinedCte.actualCosts} - ${joinedCte.certifiedBudget}) / ${joinedCte.certifiedBudget}
//         end`,

//         // Contract Budget Utilisation % (cumulative)
//         // Formula: ((Contract Budget - Cumulative Actual Costs) / Contract Budget)
//         // Note: Returns decimal (e.g., 0.2333 for 23.33%), frontend formatter handles * PERCENTAGE_DIVISOR
//         contractBudgetUtilisationPct: sql<number>`
//         case when ${joinedCte.contractBudget} = 0 then null
//              else (${joinedCte.contractBudget} -
//                     sum(${joinedCte.actualCosts}) over (
//                       partition by ${cumulativePartitionExpr}
//                       order by ${joinedCte.bucket}
//                       rows between unbounded preceding and current row
//                     )) / ${joinedCte.contractBudget}
//         end`,

//         // Period Applied: Total period linked to this cost code (before retention & VAT)
//         // Raw sum of appliedAmount for valuation line items
//         periodApplied: sql<number>`${joinedCte.periodApplied}`,

//         // Period Certified: Total period certified linked to this cost code (before retention & VAT)
//         // Raw sum of certifiedAmount for valuation line items
//         periodCertified: sql<number>`${joinedCte.periodCertified}`,

//         // Period Applied - Actual Costs
//         // The total period applied minus actual costs for this cost code
//         periodAppliedMinusActualCosts: sql<number>`(${joinedCte.periodApplied} - ${joinedCte.actualCosts})`,
//         // Period Applied - Actual Costs %
//         // Formula: (Period Applied - Actual Costs) / Period Applied
//         periodAppliedMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.periodApplied} = 0 then null
//              else (${joinedCte.periodApplied} - ${joinedCte.actualCosts}) / ${joinedCte.periodApplied} end`,

//         // Period Certified - Actual Costs
//         // The total period certified minus actual costs for this cost code
//         periodCertifiedMinusActualCosts: sql<number>`(${joinedCte.periodCertified} - ${joinedCte.actualCosts})`,
//         // Period Certified - Actual Costs %
//         // Formula: (Period Certified - Actual Costs) / Period Certified
//         periodCertifiedMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.periodCertified} = 0 then null
//              else (${joinedCte.periodCertified} - ${joinedCte.actualCosts}) / ${joinedCte.periodCertified} end`,

//         // Actual Sales - Actual Costs
//         // The total actual sales minus actual costs for this cost code
//         actualSalesMinusActualCosts: sql<number>`(${joinedCte.actualSales} - ${joinedCte.actualCosts})`,
//         // Actual Sales - Actual Costs %
//         // Formula: (Actual Sales - Actual Costs) / Actual Sales
//         actualSalesMinusActualCostsPct: sql<number>`
//         case when ${joinedCte.actualSales} = 0 then null
//              else (${joinedCte.actualSales} - ${joinedCte.actualCosts}) / ${joinedCte.actualSales} end`,

//         // Period Actual Costs (Subtotal)
//         // The sum of approved timesheet/document subtotals for this period bucket
//         periodActualCostsSubtotal: sql<number>`${joinedCte.actualCosts}`,

//         // Cumulative Actual Costs (Subtotal)
//         // Running sum of period actual costs up to and including this bucket
//         cumulativeActualCostsSubtotal: sql<number>`
//           sum(${joinedCte.actualCosts}) over (
//           partition by ${cumulativePartitionExpr}
//           order by ${joinedCte.bucket}
//           rows between unbounded preceding and current row
//         )`,

//         // Budget Utilisation % (period actual costs / forecast budget)
//         budgetUtilisationPct: sql<number>`
//         case when ${joinedCte.contractBudget} = 0 then null
//              else (${joinedCte.actualCosts} / ${joinedCte.contractBudget})
//         end`,

//         // Cumulative Budget Utilisation % (cumulative actual costs / forecast budget)
//         cumulativeBudgetUtilisationPct: sql<number>`
//         case when ${joinedCte.contractBudget} = 0 then null
//              else (
//                sum(${joinedCte.actualCosts}) over (
//                  partition by ${cumulativePartitionExpr}
//                  order by ${joinedCte.bucket}
//                  rows between unbounded preceding and current row
//                ) / ${joinedCte.contractBudget}
//              )
//         end`,

//         // Period margin metrics
//         periodAppliedActualMargin: sql<number>`(${joinedCte.periodApplied} - ${joinedCte.actualCosts})`,
//         periodCertifiedActualMargin: sql<number>`(${joinedCte.periodCertified} - ${joinedCte.actualCosts})`,
//         actualMargin: sql<number>`(${joinedCte.actualSales} - ${joinedCte.actualCosts})`,
//         periodAppliedActualMarginPct: sql<number>`
//         case when ${joinedCte.periodApplied} = 0 then null
//              else (${joinedCte.periodApplied} - ${joinedCte.actualCosts}) / ${joinedCte.periodApplied}
//         end`,
//         periodCertifiedActualMarginPct: sql<number>`
//         case when ${joinedCte.periodCertified} = 0 then null
//              else (${joinedCte.periodCertified} - ${joinedCte.actualCosts}) / ${joinedCte.periodCertified}
//         end`,
//         actualMarginPct: sql<number>`
//         case when ${joinedCte.actualSales} = 0 then null
//              else (${joinedCte.actualSales} - ${joinedCte.actualCosts}) / ${joinedCte.actualSales}
//         end`,

//         // Cumulative margin metrics
//         cumulativeAppliedActualMargin: sql<number>`
//           (
//             sum(${joinedCte.periodApplied}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) -
//             sum(${joinedCte.actualCosts}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             )
//           )
//         `,
//         cumulativeCertifiedActualMargin: sql<number>`
//           (
//             sum(${joinedCte.periodCertified}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) -
//             sum(${joinedCte.actualCosts}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             )
//           )
//         `,
//         cumulativeAppliedActualMarginPct: sql<number>`
//           case
//             when sum(${joinedCte.periodApplied}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) = 0 then null
//             else (
//               (
//                 sum(${joinedCte.periodApplied}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 ) -
//                 sum(${joinedCte.actualCosts}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 )
//               ) /
//               sum(${joinedCte.periodApplied}) over (
//                 partition by ${cumulativePartitionExpr}
//                 order by ${joinedCte.bucket}
//                 rows between unbounded preceding and current row
//               )
//             )
//           end
//         `,
//         cumulativeCertifiedActualMarginPct: sql<number>`
//           case
//             when sum(${joinedCte.periodCertified}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) = 0 then null
//             else (
//               (
//                 sum(${joinedCte.periodCertified}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 ) -
//                 sum(${joinedCte.actualCosts}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 )
//               ) /
//               sum(${joinedCte.periodCertified}) over (
//                 partition by ${cumulativePartitionExpr}
//                 order by ${joinedCte.bucket}
//                 rows between unbounded preceding and current row
//               )
//             )
//           end
//         `,

//         // Applied vs certified gap metrics
//         periodAppliedVsCertifiedGap: sql<number>`(${joinedCte.periodApplied} - ${joinedCte.periodCertified})`,
//         periodAppliedVsCertifiedGapPct: sql<number>`
//         case when ${joinedCte.periodApplied} = 0 then null
//              else (${joinedCte.periodApplied} - ${joinedCte.periodCertified}) / ${joinedCte.periodApplied}
//         end`,
//         cumulativeAppliedVsCertifiedGap: sql<number>`
//           (
//             sum(${joinedCte.periodApplied}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) -
//             sum(${joinedCte.periodCertified}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             )
//           )
//         `,
//         cumulativeAppliedVsCertifiedGapPct: sql<number>`
//           case
//             when sum(${joinedCte.periodApplied}) over (
//               partition by ${cumulativePartitionExpr}
//               order by ${joinedCte.bucket}
//               rows between unbounded preceding and current row
//             ) = 0 then null
//             else (
//               (
//                 sum(${joinedCte.periodApplied}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 ) -
//                 sum(${joinedCte.periodCertified}) over (
//                   partition by ${cumulativePartitionExpr}
//                   order by ${joinedCte.bucket}
//                   rows between unbounded preceding and current row
//                 )
//               ) /
//               sum(${joinedCte.periodApplied}) over (
//                 partition by ${cumulativePartitionExpr}
//                 order by ${joinedCte.bucket}
//                 rows between unbounded preceding and current row
//               )
//             )
//           end
//         `,

//         // Net valuation / payment due metrics
//         netValuationApplied: joinedCte.netValuationApplied,
//         netValuationCertified: joinedCte.netValuationCertified,
//         grossPaymentDueApplied: joinedCte.grossPaymentDueApplied,
//         grossPaymentDueCertified: joinedCte.grossPaymentDueCertified,
//         vatApplied: joinedCte.vatApplied,
//         vatCertified: joinedCte.vatCertified,
//         netPaymentDueApplied: joinedCte.netPaymentDueApplied,
//         netPaymentDueCertified: joinedCte.netPaymentDueCertified,
//       })
//       .from(joinedCte)
//       .leftJoin(
//         dimensionUniverseCte,
//         sql`${dimensionUniverseCte.costCodeId} IS NOT DISTINCT FROM ${joinedCte.costCodeId}`,
//       )
//       .leftJoin(
//         costCodeEntity,
//         and(eq(costCodeEntity.id, joinedCte.costCodeId), eq(costCodeEntity.tenantId, this.tenantId)),
//       )
//       .leftJoin(
//         customTagEntity,
//         and(eq(customTagEntity.id, joinedCte.customTagId), eq(customTagEntity.tenantId, this.tenantId)),
//       );

//     const stmt =
//       /* @coreloops-ignore-tenant-check - joined CTE graph is already tenant-scoped via withTenant-filtered source CTEs */
//       baseQuery.orderBy(
//         sql`lower(coalesce(${joinedCte.projectName}, '')) asc`,
//         sql`lower(${dimensionUniverseCte.name}) asc nulls last`,
//         joinedCte.costCodeId,
//         joinedCte.bucket,
//       );

//     // NOTE: keeping this log while the report is still evolving is useful
//     // for debugging / comparing with handwritten SQL. Consider gating it
//     // behind an env flag once the query stabilises.
//     this.logger.debug('SQL Statement', stmt.toSQL().sql);

//     const rows = await stmt;
//     return rows.map(roundReportRowTo2dp);
//   }

//   /**
//    * Retrieves the data for the resource report table based on the given parameters. This method performs
//    * data aggregation from timesheets and timesheet line items to generate labour-related metrics
//    * for the specified project within a defined time range.
//    *
//    * @param {GetCostReportTableArgs} args - The input arguments required to generate the resource report table data.
//    * This includes the following properties:
//    *   - projectId: Identifier for the project for which the report is generated.
//    *   - dateFrom: The start date of the reporting period.
//    *   - dateTo: The end date of the reporting period.
//    *
//    * @return {Promise<ResourceReportRow[]>} A promise that resolves with the structured data for the resource report table,
//    * containing information such as days worked, hours worked, subtotal, VAT, deductions, and gross total over a
//    * specific time interval, grouped by cost code, supplier, or contact.
//    */
//   async getResourceReportTableData(
//     args: GetCostReportTableArgs,
//     reportView: ReportViewSelectEntity,
//   ): Promise<ResourceReportRow[]> {
//     const db = this.drizzle.db;

//     const projectId = args.projectId;
//     const from = new Date(args.dateFrom);
//     const to = new Date(args.dateTo);
//     const interval = ReportViewTimeIncrementEnum.MONTHLY;

//     // If a projectId is provided, and we're *not* in "all projects" mode,
//     // constrain all downstream CTEs to that project. Otherwise, leave
//     // the project unconstrained and rely on tenant scoping.
//     // When in "all projects" mode, check if the report view has selected projects.
//     const projectsForReport = this.getProjectsForReport(reportView);
//     const projectFilter = this.buildScopedFilter(
//       'projectId',
//       projectId && !args.isAllProjects ? projectId : undefined,
//       args.isAllProjects && projectsForReport.length > 0 ? projectsForReport : [],
//     );

//     // CTE: time buckets for the selected range (e.g. one row per month).
//     const bucketsCte = db.$with('buckets').as(qb => this.bucketSeriesQB(qb, interval, from, to));

//     // Use the timesheet week start so report period filtering matches the timesheet flows.
//     const timesheetDateCol: SQL = sql`${timesheetEntity.startOfWeek}`;
//     const timesheetLineItemDateCol: SQL = sql`${timesheetEntity.startOfWeek}`;
//     const resourceContactIdExpr: SQL = sql`coalesce(${timesheetLineItemEntity.contactId}, ${timesheetEntity.contactId})`;
//     const approvedTimesheetFilter = this.mapFilterToQuery({
//       filter: this.withTenant({
//         status: { eq: EntityStatusEnum.APPROVED },
//       }),
//       table: timesheetEntity,
//     });
//     const timesheetPeriodFilter = this.mapFilterToQuery({
//       filter: this.withTenant({
//         startOfWeek: { gte: from, lte: to },
//       }),
//       table: timesheetEntity,
//     });

//     // CTE: allocation of timesheet line items ↔ cost codes.
//     // A single timesheet line item can be tagged with multiple cost codes.
//     // We compute a windowed count(*) so that we can split the line total
//     // evenly across its associated cost codes later.
//     const timesheetAllocCte = db.$with('timesheet_alloc').as(
//       db
//         .select({
//           timesheetLineItemId: entityCostCodeEntity.timesheetLineItemId,
//           costCodeId: entityCostCodeEntity.costCodeId,
//           codeCount: sql<number>`count(*) over (partition by ${entityCostCodeEntity.timesheetLineItemId})`.as(
//             'code_count',
//           ),
//         })
//         .from(entityCostCodeEntity)
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant<EntityCostCodeModel>({
//               and: [
//                 projectFilter,
//                 {
//                   timesheetLineItemId: { isNot: null },
//                 },
//               ],
//             }),
//             table: entityCostCodeEntity,
//           }),
//         ),
//     );

//     // CTE: Days Worked per (bucket, contactId)
//     // Sum day-unit quantities so the resource report matches the export's days-worked calculation.
//     // Days worked should be counted per contact, not per cost code combination.
//     // Only includes APPROVED timesheets.
//     const daysWorkedByContactCte = db.$with('days_worked_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.DAYS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Days Worked per (bucket, supplierId)
//     // Sum day-unit quantities so the resource report matches the export's days-worked calculation.
//     // Days worked should be counted per supplier, not per cost code combination.
//     // Only includes APPROVED timesheets.
//     const daysWorkedBySupplierCte = db.$with('days_worked_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 supplierId: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.DAYS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Days Worked per (bucket, costCodeId, supplierId, contactId)
//     // This combines contact and supplier days worked for joining with the base grid
//     // We set costCodeId to null since days worked shouldn't be split by cost code
//     const daysWorkedCte = db.$with('days_worked').as(
//       db
//         .select({
//           bucket: sql<Date>`daysWorked.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`daysWorked.contact_id`.as('contact_id'),
//           value: sql<number>`daysWorked.value`.as('value'),
//         })
//         .from(sql`${daysWorkedByContactCte} daysWorked`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`daysWorked.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`daysWorked.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`daysWorked.value`.as('value'),
//             })
//             .from(sql`${daysWorkedBySupplierCte} daysWorked`),
//         ),
//     );

//     // CTE: Hours Worked per (bucket, contactId) - for contact grouping
//     // Sum of quantity from timesheet line items
//     // Only includes line items with types in labourLineItemTypes
//     // Only includes APPROVED timesheets
//     const hoursWorkedByContactCte = db.$with('hours_worked_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Hours Worked per (bucket, supplierId) - for supplier grouping
//     // Sum hour-unit labour quantities so the report aligns with the export's hour logic.
//     // Only includes APPROVED timesheets.
//     const hoursWorkedBySupplierCte = db.$with('hours_worked_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Hours Worked per (bucket, costCodeId, supplierId, contactId)
//     // Sum of quantity from timesheet line items
//     // Uses timesheetAllocCte.codeCount to distribute each line item quantity
//     // evenly across its linked cost codes (for cost code grouping)
//     const hoursWorkedCte = db.$with('hours_worked').as(
//       db
//         .select({
//           bucket: sql<Date>`hoursWorked.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`hoursWorked.contact_id`.as('contact_id'),
//           value: sql<number>`hoursWorked.value`.as('value'),
//         })
//         .from(sql`${hoursWorkedByContactCte} hoursWorked`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`hoursWorked.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`hoursWorked.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`hoursWorked.value`.as('value'),
//             })
//             .from(sql`${hoursWorkedBySupplierCte} hoursWorked`),
//         ),
//     );

//     // CTE: Standard Hours per (bucket, contactId) - for contact grouping
//     // Sum hour-unit labour quantities that are not overtime.
//     const standardHoursByContactCte = db.$with('standard_hours_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.OVERTIME}`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Standard Hours per (bucket, supplierId) - for supplier grouping
//     // Sum hour-unit labour quantities that are not overtime.
//     const standardHoursBySupplierCte = db.$with('standard_hours_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.OVERTIME}`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Standard Hours per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier standard hours for joining.
//     const standardHoursCte = db.$with('standard_hours').as(
//       db
//         .select({
//           bucket: sql<Date>`standardHours.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`standardHours.contact_id`.as('contact_id'),
//           value: sql<number>`standardHours.value`.as('value'),
//         })
//         .from(sql`${standardHoursByContactCte} standardHours`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`standardHours.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`standardHours.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`standardHours.value`.as('value'),
//             })
//             .from(sql`${standardHoursBySupplierCte} standardHours`),
//         ),
//     );

//     // CTE: Standard Pay per (bucket, contactId) - for contact grouping
//     // Sum standard day/hour subtotals so pay columns follow the export's standard/overtime split.
//     const standardPayByContactCte = db.$with('standard_pay_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { in: [TimesheetLineItemScaffoldType.DAYS, TimesheetLineItemScaffoldType.HOURS] },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.OVERTIME}`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Standard Pay per (bucket, supplierId) - for supplier grouping
//     // Sum standard day/hour subtotals so pay columns follow the export's standard/overtime split.
//     const standardPayBySupplierCte = db.$with('standard_pay_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 unit: { in: [TimesheetLineItemScaffoldType.DAYS, TimesheetLineItemScaffoldType.HOURS] },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.OVERTIME}`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Standard Pay per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier standard pay for joining.
//     const standardPayCte = db.$with('standard_pay').as(
//       db
//         .select({
//           bucket: sql<Date>`standardPay.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`standardPay.contact_id`.as('contact_id'),
//           value: sql<number>`standardPay.value`.as('value'),
//         })
//         .from(sql`${standardPayByContactCte} standardPay`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`standardPay.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`standardPay.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`standardPay.value`.as('value'),
//             })
//             .from(sql`${standardPayBySupplierCte} standardPay`),
//         ),
//     );

//     // CTE: Overtime Hours per (bucket, contactId) - for contact grouping
//     // Sum of quantity from hour-unit timesheet line items where type is OVERTIME.
//     // Only includes APPROVED timesheets.
//     const overtimeHoursByContactCte = db.$with('overtime_hours_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//                 type: { eq: TimesheetLineItemScaffoldType.OVERTIME },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Overtime Hours per (bucket, supplierId) - for supplier grouping
//     // Sum of quantity from hour-unit timesheet line items where type is OVERTIME.
//     // Only includes APPROVED timesheets.
//     const overtimeHoursBySupplierCte = db.$with('overtime_hours_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.quantity})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 unit: { eq: TimesheetLineItemScaffoldType.HOURS },
//                 type: { eq: TimesheetLineItemScaffoldType.OVERTIME },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Overtime Hours per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier overtime hours for joining
//     const overtimeHoursCte = db.$with('overtime_hours').as(
//       db
//         .select({
//           bucket: sql<Date>`overtimeHours.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`overtimeHours.contact_id`.as('contact_id'),
//           value: sql<number>`overtimeHours.value`.as('value'),
//         })
//         .from(sql`${overtimeHoursByContactCte} overtimeHours`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`overtimeHours.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`overtimeHours.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`overtimeHours.value`.as('value'),
//             })
//             .from(sql`${overtimeHoursBySupplierCte} overtimeHours`),
//         ),
//     );

//     // CTE: Overtime Pay per (bucket, contactId) - for contact grouping
//     // Sum day/hour overtime subtotals so pay columns follow the export's standard/overtime split.
//     // Only includes APPROVED timesheets.
//     const overtimePayByContactCte = db.$with('overtime_pay_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 unit: { in: [TimesheetLineItemScaffoldType.DAYS, TimesheetLineItemScaffoldType.HOURS] },
//                 type: { eq: TimesheetLineItemScaffoldType.OVERTIME },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Overtime Pay per (bucket, supplierId) - for supplier grouping
//     // Sum day/hour overtime subtotals so pay columns follow the export's standard/overtime split.
//     // Only includes APPROVED timesheets.
//     const overtimePayBySupplierCte = db.$with('overtime_pay_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 unit: { in: [TimesheetLineItemScaffoldType.DAYS, TimesheetLineItemScaffoldType.HOURS] },
//                 type: { eq: TimesheetLineItemScaffoldType.OVERTIME },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Overtime Pay per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier overtime pay for joining
//     const overtimePayCte = db.$with('overtime_pay').as(
//       db
//         .select({
//           bucket: sql<Date>`overtimePay.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`overtimePay.contact_id`.as('contact_id'),
//           value: sql<number>`overtimePay.value`.as('value'),
//         })
//         .from(sql`${overtimePayByContactCte} overtimePay`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`overtimePay.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`overtimePay.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`overtimePay.value`.as('value'),
//             })
//             .from(sql`${overtimePayBySupplierCte} overtimePay`),
//         ),
//     );

//     // CTE: Subtotal per (bucket, contactId) - for contact grouping
//     // Sum of subtotal from timesheet line items
//     // Only includes APPROVED timesheets
//     const subtotalByContactCte = db.$with('subtotal_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.MATERIALS}`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.DEDUCTIONS}`,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), resourceContactIdExpr),
//     );

//     // CTE: Subtotal per (bucket, supplierId) - for supplier grouping
//     // Sum of subtotal from timesheet line items
//     // Only includes APPROVED timesheets
//     const subtotalBySupplierCte = db.$with('subtotal_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`coalesce(${timesheetLineItemEntity.isDeduction}, false) = false`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.MATERIALS}`,
//             sql`coalesce(${timesheetLineItemEntity.type}::text, '') <> ${TimesheetLineItemScaffoldType.DEDUCTIONS}`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Subtotal per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier subtotals for joining
//     const subtotalCte = db.$with('subtotal').as(
//       db
//         .select({
//           bucket: sql<Date>`subtotal.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`subtotal.contact_id`.as('contact_id'),
//           value: sql<number>`subtotal.value`.as('value'),
//         })
//         .from(sql`${subtotalByContactCte} subtotal`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`subtotal.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`subtotal.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`subtotal.value`.as('value'),
//             })
//             .from(sql`${subtotalBySupplierCte} subtotal`),
//         ),
//     );

//     // CTE: VAT per (bucket, contactId) - for contact grouping
//     // Sum of tax_amount from timesheet line items
//     // Only includes APPROVED timesheets
//     const vatByContactCte = db.$with('vat_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.taxAmount})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), resourceContactIdExpr),
//     );

//     // CTE: VAT per (bucket, supplierId) - for supplier grouping
//     // Sum of tax_amount from timesheet line items
//     // Only includes APPROVED timesheets
//     const vatBySupplierCte = db.$with('vat_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.taxAmount})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: VAT per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier VAT for joining
//     const vatCte = db.$with('vat').as(
//       db
//         .select({
//           bucket: sql<Date>`vat.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`vat.contact_id`.as('contact_id'),
//           value: sql<number>`vat.value`.as('value'),
//         })
//         .from(sql`${vatByContactCte} vat`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`vat.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`vat.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`vat.value`.as('value'),
//             })
//             .from(sql`${vatBySupplierCte} vat`),
//         ),
//     );

//     // CTE: Deductions per (bucket, contactId) - for contact grouping
//     // Sum of total from timesheet line items where type is DEDUCTIONS
//     // Only includes APPROVED timesheets
//     const deductionsByContactCte = db.$with('deductions_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(
//             case when ${timesheetLineItemEntity.isDeduction} = true
//             then abs(${timesheetLineItemEntity.subtotal})
//             else 0
//             end
//           )`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 type: { eq: TimesheetLineItemScaffoldType.DEDUCTIONS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Deductions per (bucket, supplierId) - for supplier grouping
//     // Sum of total from timesheet line items where type is DEDUCTIONS
//     // Only includes APPROVED timesheets
//     const deductionsBySupplierCte = db.$with('deductions_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(
//             case when ${timesheetLineItemEntity.isDeduction} = true
//             then abs(${timesheetLineItemEntity.subtotal})
//             else 0
//             end
//           )`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 type: { eq: TimesheetLineItemScaffoldType.DEDUCTIONS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Deductions per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier deductions for joining
//     const deductionsCte = db.$with('deductions').as(
//       db
//         .select({
//           bucket: sql<Date>`deductions.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`deductions.contact_id`.as('contact_id'),
//           value: sql<number>`deductions.value`.as('value'),
//         })
//         .from(sql`${deductionsByContactCte} deductions`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`deductions.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`deductions.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`deductions.value`.as('value'),
//             })
//             .from(sql`${deductionsBySupplierCte} deductions`),
//         ),
//     );

//     // CTE: Materials per (bucket, contactId) - for contact grouping
//     // Sum of total from timesheet line items where type is MATERIALS
//     // Only includes APPROVED timesheets
//     const materialsByContactCte = db.$with('materials_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//                 type: { eq: TimesheetLineItemScaffoldType.MATERIALS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: Materials per (bucket, supplierId) - for supplier grouping
//     // Sum of total from timesheet line items where type is MATERIALS
//     // Only includes APPROVED timesheets
//     const materialsBySupplierCte = db.$with('materials_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.subtotal})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//                 type: { eq: TimesheetLineItemScaffoldType.MATERIALS },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Materials per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier materials for joining
//     const materialsCte = db.$with('materials').as(
//       db
//         .select({
//           bucket: sql<Date>`materials.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`materials.contact_id`.as('contact_id'),
//           value: sql<number>`materials.value`.as('value'),
//         })
//         .from(sql`${materialsByContactCte} materials`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`materials.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`materials.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`materials.value`.as('value'),
//             })
//             .from(sql`${materialsBySupplierCte} materials`),
//         ),
//     );

//     // CTE: CIS Amount per (bucket, contactId) - for contact grouping
//     // Sum of non-material line item CIS deductions on APPROVED timesheets
//     const cisAmountByContactCte = db.$with('cis_amount_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(
//             case
//               when ${contactEntity.cisRegistered} is distinct from true then 0
//               when coalesce(${timesheetLineItemEntity.isDeduction}, false) = true then 0
//               when ${timesheetLineItemEntity.type} = ${TimesheetLineItemScaffoldType.MATERIALS} then 0
//               when ${timesheetLineItemEntity.type} = ${TimesheetLineItemScaffoldType.DEDUCTIONS} then 0
//               when coalesce(${timesheetLineItemEntity.cisRate}, 0) = 0 then 0
//               else coalesce(${timesheetLineItemEntity.total}, 0) * (coalesce(${timesheetLineItemEntity.cisRate}, 0) / 100.0)
//             end
//           )`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .leftJoin(
//           contactEntity,
//           sql`${contactEntity.id} = ${resourceContactIdExpr} and ${contactEntity.tenantId} = ${this.tenantId}`,
//         )
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), resourceContactIdExpr),
//     );

//     // CTE: CIS Amount per (bucket, supplierId) - for supplier grouping
//     // Sum of non-material line item CIS deductions on APPROVED timesheets
//     const cisAmountBySupplierCte = db.$with('cis_amount_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetLineItemDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(
//             case
//               when ${contactEntity.cisRegistered} is distinct from true then 0
//               when coalesce(${timesheetLineItemEntity.isDeduction}, false) = true then 0
//               when ${timesheetLineItemEntity.type} = ${TimesheetLineItemScaffoldType.MATERIALS} then 0
//               when ${timesheetLineItemEntity.type} = ${TimesheetLineItemScaffoldType.DEDUCTIONS} then 0
//               when coalesce(${timesheetLineItemEntity.cisRate}, 0) = 0 then 0
//               else coalesce(${timesheetLineItemEntity.total}, 0) * (coalesce(${timesheetLineItemEntity.cisRate}, 0) / 100.0)
//             end
//           )`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .leftJoin(
//           contactEntity,
//           sql`${contactEntity.id} = ${resourceContactIdExpr} and ${contactEntity.tenantId} = ${this.tenantId}`,
//         )
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetLineItemDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: CIS Amount per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier CIS totals for joining
//     const cisAmountCte = db.$with('cis_amount').as(
//       db
//         .select({
//           bucket: sql<Date>`cisAmount.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`cisAmount.contact_id`.as('contact_id'),
//           value: sql<number>`cisAmount.value`.as('value'),
//         })
//         .from(sql`${cisAmountByContactCte} cisAmount`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`cisAmount.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`cisAmount.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`cisAmount.value`.as('value'),
//             })
//             .from(sql`${cisAmountBySupplierCte} cisAmount`),
//         ),
//     );

//     // CTE: Gross Total per (bucket, contactId) - for contact grouping
//     // Sum of total from timesheet line items
//     // Only includes APPROVED timesheets
//     const grossTotalByContactCte = db.$with('gross_total_by_contact').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//           value: sql<number>`sum(${timesheetLineItemEntity.total})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//             sql`${resourceContactIdExpr} is not null`,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), resourceContactIdExpr),
//     );

//     // CTE: Gross Total per (bucket, supplierId) - for supplier grouping
//     // Sum of total from timesheet line items
//     // Only includes APPROVED timesheets
//     const grossTotalBySupplierCte = db.$with('gross_total_by_supplier').as(
//       db
//         .select({
//           bucket: this.bucketExpr(interval, timesheetDateCol).as('bucket'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           value: sql<number>`sum(${timesheetLineItemEntity.total})`.as('value'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 supplierId: { isNot: null },
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(this.bucketExpr(interval, timesheetDateCol), timesheetLineItemEntity.supplierId),
//     );

//     // CTE: Gross Total per (bucket, costCodeId, supplierId, contactId)
//     // Combines contact and supplier gross totals for joining
//     const grossTotalCte = db.$with('gross_total').as(
//       db
//         .select({
//           bucket: sql<Date>`grossTotal.bucket`.as('bucket'),
//           costCodeId: sql<string>`null`.as('cost_code_id'),
//           supplierId: sql<string>`null`.as('supplier_id'),
//           contactId: sql<string>`grossTotal.contact_id`.as('contact_id'),
//           value: sql<number>`grossTotal.value`.as('value'),
//         })
//         .from(sql`${grossTotalByContactCte} grossTotal`)
//         .union(
//           db
//             .select({
//               bucket: sql<Date>`grossTotal.bucket`.as('bucket'),
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`grossTotal.supplier_id`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//               value: sql<number>`grossTotal.value`.as('value'),
//             })
//             .from(sql`${grossTotalBySupplierCte} grossTotal`),
//         ),
//     );

//     // CTE: universe of grouping entities (cost codes, suppliers, contacts)
//     // Get all distinct combinations from timesheet line items and entity_cost_codes
//     // Includes a UNION with (null, null, null) to ensure buckets are returned even when no timesheets exist
//     const groupingEntitiesCte = db.$with('grouping_entities').as(
//       db
//         .select({
//           costCodeId: sql<string>`coalesce(${entityCostCodeEntity.costCodeId}, null)`.as('cost_code_id'),
//           supplierId: timesheetLineItemEntity.supplierId,
//           contactId: sql<string | null>`${resourceContactIdExpr}`.as('contact_id'),
//         })
//         .from(timesheetLineItemEntity)
//         .innerJoin(timesheetEntity, eq(timesheetLineItemEntity.timesheetId, timesheetEntity.id))
//         .leftJoin(entityCostCodeEntity, eq(entityCostCodeEntity.timesheetLineItemId, timesheetLineItemEntity.id))
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant({
//                 ...projectFilter,
//                 date: { isNot: null },
//               }),
//               table: timesheetLineItemEntity,
//             }),
//             approvedTimesheetFilter,
//             timesheetPeriodFilter,
//           ),
//         )
//         .groupBy(entityCostCodeEntity.costCodeId, timesheetLineItemEntity.supplierId, resourceContactIdExpr)
//         .union(
//           db
//             .select({
//               costCodeId: sql<string>`null`.as('cost_code_id'),
//               supplierId: sql<string>`null`.as('supplier_id'),
//               contactId: sql<string>`null`.as('contact_id'),
//             })
//             .from(sql`(select 1) as dummy`),
//         ),
//     );

//     // CTE: base grid = all (bucket, grouping entity) combinations
//     const baseCte = db.$with('base').as(queryBuilder =>
//       queryBuilder
//         .select({
//           bBucket: sql<Date>`bucket.bucket`.as('b_bucket'),
//           bCostCodeId: sql<string>`groupingEntity.cost_code_id`.as('b_cost_code_id'),
//           bSupplierId: sql<string>`groupingEntity.supplier_id`.as('b_supplier_id'),
//           bContactId: sql<string>`groupingEntity.contact_id`.as('b_contact_id'),
//         })
//         .from(sql`${bucketsCte} bucket`)
//         .innerJoin(sql`${groupingEntitiesCte} groupingEntity`, sql`true`),
//     );

//     // CTE: the final joined per (bucket, grouping entity) row, with all values coalesced to 0
//     const joinedCte = db.$with('joined').as(queryBuilder =>
//       queryBuilder
//         .select({
//           bucket: sql<Date>`base.b_bucket`.as('bucket'),
//           costCodeId: sql<string>`base.b_cost_code_id`.as('cost_code_id'),
//           supplierId: sql<string>`base.b_supplier_id`.as('supplier_id'),
//           contactId: sql<string>`base.b_contact_id`.as('contact_id'),
//           daysWorked: sql<number>`coalesce(daysWorked.value, 0)`.as('days_worked'),
//           hoursWorked: sql<number>`coalesce(hoursWorked.value, 0)`.as('hours_worked'),
//           standardHours: sql<number>`coalesce(standardHours.value, 0)`.as('standard_hours'),
//           standardPay: sql<number>`coalesce(standardPay.value, 0)`.as('standard_pay'),
//           overtimeHours: sql<number>`coalesce(overtimeHours.value, 0)`.as('overtime_hours'),
//           overtimePay: sql<number>`coalesce(overtimePay.value, 0)`.as('overtime_pay'),
//           subtotal: sql<number>`coalesce(subtotal.value, 0)`.as('subtotal'),
//           vat: sql<number>`coalesce(vat.value, 0)`.as('vat'),
//           deductions: sql<number>`coalesce(deductions.value, 0)`.as('deductions'),
//           materials: sql<number>`coalesce(materials.value, 0)`.as('materials'),
//           grossTotal: sql<number>`
//             coalesce(subtotal.value, 0)
//             + coalesce(vat.value, 0)
//             - coalesce(deductions.value, 0)
//             + coalesce(materials.value, 0)
//           `.as('gross_total'),
//           cisAmount: sql<number>`coalesce(cisAmount.value, 0)`.as('cis_amount'),
//           netPaymentDue: sql<number>`
//             (
//               coalesce(subtotal.value, 0)
//               + coalesce(vat.value, 0)
//               - coalesce(deductions.value, 0)
//               + coalesce(materials.value, 0)
//             ) - coalesce(cisAmount.value, 0)
//           `.as('net_payment_due'),
//         })
//         .from(sql`${baseCte} base`)
//         .leftJoin(
//           sql`${daysWorkedCte} daysWorked`,
//           sql`daysWorked.bucket = base.b_bucket and (
//             (daysWorked.contact_id = base.b_contact_id and daysWorked.contact_id is not null and daysWorked.supplier_id is null) or
//             (daysWorked.supplier_id = base.b_supplier_id and daysWorked.supplier_id is not null and daysWorked.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${hoursWorkedCte} hoursWorked`,
//           sql`hoursWorked.bucket = base.b_bucket and (
//             (hoursWorked.contact_id = base.b_contact_id and hoursWorked.contact_id is not null and hoursWorked.supplier_id is null) or
//             (hoursWorked.supplier_id = base.b_supplier_id and hoursWorked.supplier_id is not null and hoursWorked.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${standardHoursCte} standardHours`,
//           sql`standardHours.bucket = base.b_bucket and (
//             (standardHours.contact_id = base.b_contact_id and standardHours.contact_id is not null and standardHours.supplier_id is null) or
//             (standardHours.supplier_id = base.b_supplier_id and standardHours.supplier_id is not null and standardHours.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${standardPayCte} standardPay`,
//           sql`standardPay.bucket = base.b_bucket and (
//             (standardPay.contact_id = base.b_contact_id and standardPay.contact_id is not null and standardPay.supplier_id is null) or
//             (standardPay.supplier_id = base.b_supplier_id and standardPay.supplier_id is not null and standardPay.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${overtimeHoursCte} overtimeHours`,
//           sql`overtimeHours.bucket = base.b_bucket and (
//             (overtimeHours.contact_id = base.b_contact_id and overtimeHours.contact_id is not null and overtimeHours.supplier_id is null) or
//             (overtimeHours.supplier_id = base.b_supplier_id and overtimeHours.supplier_id is not null and overtimeHours.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${overtimePayCte} overtimePay`,
//           sql`overtimePay.bucket = base.b_bucket and (
//             (overtimePay.contact_id = base.b_contact_id and overtimePay.contact_id is not null and overtimePay.supplier_id is null) or
//             (overtimePay.supplier_id = base.b_supplier_id and overtimePay.supplier_id is not null and overtimePay.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${subtotalCte} subtotal`,
//           sql`subtotal.bucket = base.b_bucket and (
//             (subtotal.contact_id = base.b_contact_id and subtotal.contact_id is not null and subtotal.supplier_id is null) or
//             (subtotal.supplier_id = base.b_supplier_id and subtotal.supplier_id is not null and subtotal.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${vatCte} vat`,
//           sql`vat.bucket = base.b_bucket and (
//             (vat.contact_id = base.b_contact_id and vat.contact_id is not null and vat.supplier_id is null) or
//             (vat.supplier_id = base.b_supplier_id and vat.supplier_id is not null and vat.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${deductionsCte} deductions`,
//           sql`deductions.bucket = base.b_bucket and (
//             (deductions.contact_id = base.b_contact_id and deductions.contact_id is not null and deductions.supplier_id is null) or
//             (deductions.supplier_id = base.b_supplier_id and deductions.supplier_id is not null and deductions.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${materialsCte} materials`,
//           sql`materials.bucket = base.b_bucket and (
//             (materials.contact_id = base.b_contact_id and materials.contact_id is not null and materials.supplier_id is null) or
//             (materials.supplier_id = base.b_supplier_id and materials.supplier_id is not null and materials.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${grossTotalCte} grossTotal`,
//           sql`grossTotal.bucket = base.b_bucket and (
//             (grossTotal.contact_id = base.b_contact_id and grossTotal.contact_id is not null and grossTotal.supplier_id is null) or
//             (grossTotal.supplier_id = base.b_supplier_id and grossTotal.supplier_id is not null and grossTotal.contact_id is null)
//           )`,
//         )
//         .leftJoin(
//           sql`${cisAmountCte} cisAmount`,
//           sql`cisAmount.bucket = base.b_bucket and (
//             (cisAmount.contact_id = base.b_contact_id and cisAmount.contact_id is not null and cisAmount.supplier_id is null) or
//             (cisAmount.supplier_id = base.b_supplier_id and cisAmount.supplier_id is not null and cisAmount.contact_id is null)
//           )`,
//         ),
//     );

//     // Final SELECT
//     const stmt = db
//       .with(
//         bucketsCte,
//         timesheetAllocCte,
//         daysWorkedByContactCte,
//         daysWorkedBySupplierCte,
//         daysWorkedCte,
//         hoursWorkedByContactCte,
//         hoursWorkedBySupplierCte,
//         hoursWorkedCte,
//         standardHoursByContactCte,
//         standardHoursBySupplierCte,
//         standardHoursCte,
//         standardPayByContactCte,
//         standardPayBySupplierCte,
//         standardPayCte,
//         overtimeHoursByContactCte,
//         overtimeHoursBySupplierCte,
//         overtimeHoursCte,
//         overtimePayByContactCte,
//         overtimePayBySupplierCte,
//         overtimePayCte,
//         subtotalByContactCte,
//         subtotalBySupplierCte,
//         subtotalCte,
//         vatByContactCte,
//         vatBySupplierCte,
//         vatCte,
//         deductionsByContactCte,
//         deductionsBySupplierCte,
//         deductionsCte,
//         materialsByContactCte,
//         materialsBySupplierCte,
//         materialsCte,
//         grossTotalByContactCte,
//         grossTotalBySupplierCte,
//         grossTotalCte,
//         cisAmountByContactCte,
//         cisAmountBySupplierCte,
//         cisAmountCte,
//         groupingEntitiesCte,
//         baseCte,
//         joinedCte,
//       )
//       .select({
//         costCodeId: sql<string | null>`joined.cost_code_id`.as('cost_code_id'),
//         supplierId: sql<string | null>`joined.supplier_id`.as('supplier_id'),
//         contactId: sql<string | null>`joined.contact_id`.as('contact_id'),
//         bucket: sql<Date>`joined.bucket`.as('bucket'),
//         daysWorked: sql<number>`joined.days_worked`.as('days_worked'),
//         hoursWorked: sql<number>`joined.hours_worked`.as('hours_worked'),
//         standardHours: sql<number>`joined.standard_hours`.as('standard_hours'),
//         standardPay: sql<number>`joined.standard_pay`.as('standard_pay'),
//         overtimeHours: sql<number>`joined.overtime_hours`.as('overtime_hours'),
//         overtimePay: sql<number>`joined.overtime_pay`.as('overtime_pay'),
//         subtotal: sql<number>`joined.subtotal`.as('subtotal'),
//         vat: sql<number>`joined.vat`.as('vat'),
//         deductions: sql<number>`joined.deductions`.as('deductions'),
//         materials: sql<number>`joined.materials`.as('materials'),
//         grossTotal: sql<number>`joined.gross_total`.as('gross_total'),
//         cisAmount: sql<number>`joined.cis_amount`.as('cis_amount'),
//         netPaymentDue: sql<number>`joined.net_payment_due`.as('net_payment_due'),
//       })
//       .from(sql`${joinedCte} joined`)
//       .leftJoin(
//         costCodeEntity,
//         sql`${costCodeEntity.id} = joined.cost_code_id and ${costCodeEntity.tenantId} = ${this.tenantId}`,
//       )
//       .leftJoin(
//         supplierEntity,
//         sql`${supplierEntity.id} = joined.supplier_id and ${supplierEntity.tenantId} = ${this.tenantId}`,
//       )
//       .leftJoin(
//         contactEntity,
//         sql`${contactEntity.id} = joined.contact_id and ${contactEntity.tenantId} = ${this.tenantId}`,
//       )
//       .orderBy(
//         sql`lower(${costCodeEntity.name}) asc nulls last`,
//         sql`lower(coalesce(nullif(trim(${supplierEntity.name}), ''), '\uffff')) asc`,
//         sql`lower(coalesce(nullif(trim(${contactEntity.firstName}), ''), '\uffff')) asc`,
//         sql`joined.bucket`,
//         sql`joined.cost_code_id`,
//         sql`joined.supplier_id`,
//         sql`joined.contact_id`,
//       );

//     this.logger.debug('Resource Report SQL Statement', stmt.toSQL().sql);

//     return stmt;
//   }

//   /**
//    * Retrieves the flat row set used to build the Transaction Report.
//    *
//    * Output characteristics:
//    * - Includes APPROVED invoices and purchase orders within the requested issue date range.
//    * - Aggregates line items into `documentSubtotal` per `(documentId, costCodeId)`.
//    *   This means a single document may appear multiple times if it spans multiple cost codes.
//    * - If a line item is allocated to multiple cost codes, its subtotal is split evenly across them
//    *   (e.g. 20k across 2 cost codes => 10k each) to avoid double-counting.
//    * - Computes `paidAmount` based on document status only:
//    *   - `paidAmount = documentSubtotal` when status is PAID, otherwise 0
//    * - Computes `outstandingAmount` and `totalAmount` as:
//    *   - `outstandingAmount = 0` when status is PAID, otherwise `documentSubtotal`
//    *   - `totalAmount = documentSubtotal`
//    * - Adds invoice↔PO linkage via `documentLinkEntity` so the service layer can nest invoices under
//    *   their linked purchase order (`linkedPurchaseOrderId`).
//    *
//    * NOTE: This method returns ungrouped rows. The GraphQL service layer is responsible for shaping
//    * them into the hierarchical report structure (cost code → purchase order → invoices, plus "Other Costs").
//    *
//    * @param args - Project scoping + date range.
//    * @returns Flat `TransactionReportRow[]` used by the GraphQL service to build the report hierarchy.
//    */
//   async getTransactionReportTableData(
//     args: GetCostReportTableArgs,
//     reportView: ReportViewSelectEntity,
//   ): Promise<TransactionReportRow[]> {
//     const db = this.drizzle.db;

//     const projectId = args.projectId;
//     const from = new Date(args.dateFrom);
//     const to = new Date(args.dateTo);
//     const tenantCurrencyCode = await this.getTenantCurrencyCode();
//     const documentStatuses = this.getDocumentStatusesForReport(reportView);
//     const costCodes = this.getCostCodesForReport(reportView);

//     // If a projectId is provided, and we're *not* in "all projects" mode,
//     // constrain all downstream CTEs to that project. Otherwise, leave
//     // the project unconstrained and rely on tenant scoping.
//     // When in "all projects" mode, check if the report view has selected projects.
//     const projectsForReport = this.getProjectsForReport(reportView);
//     const isProjectScoped = Boolean(projectId && !args.isAllProjects);
//     const isProjectViewFiltered = Boolean(args.isAllProjects && projectsForReport.length > 0);
//     const isProjectFiltered = isProjectScoped || isProjectViewFiltered;

//     const projectFilterObj = this.buildScopedFilter(
//       'projectId',
//       isProjectScoped ? projectId : undefined,
//       isProjectViewFiltered ? projectsForReport : [],
//     );

//     const scopedDocumentsCte = db.$with('scoped_documents').as(qb => {
//       const baseStmt = qb
//         .select({
//           id: documentEntity.id,
//           documentType: documentEntity.documentType,
//           status: documentEntity.status,
//           documentNumber: documentEntity.documentNumber,
//           issueDate: documentEntity.issueDate,
//           reference: documentEntity.reference,
//           supplierId: documentEntity.supplierId,
//         })
//         .from(documentEntity);

//       const stmt = isProjectFiltered
//         ? baseStmt.innerJoin(documentProjectEntity, eq(documentProjectEntity.documentId, documentEntity.id))
//         : baseStmt;

//       return stmt.where(
//         and(
//           this.mapFilterToQuery({
//             filter: this.withTenant({
//               status: { in: documentStatuses },
//               documentType: {
//                 in: [DocumentTypeEnum.INVOICE, DocumentTypeEnum.PURCHASE_ORDER, DocumentTypeEnum.RECEIPT],
//               },
//             }),
//             table: documentEntity,
//           }),
//           sql`${documentEntity.issueDate} between ${from} and ${to}`,
//           isProjectFiltered
//             ? this.mapFilterToQuery({
//                 filter: this.withTenant<DocumentProjectModel>(projectFilterObj),
//                 table: documentProjectEntity,
//               })
//             : undefined,
//         ),
//       );
//     });

//     const lineItemCostCodeCountsCte = db.$with('line_item_cost_code_counts').as(qb => {
//       return qb
//         .select({
//           documentLineItemId: sql<string>`${documentLineItemEntity.id}`.as('document_line_item_id'),
//           costCodeCount: sql<number>`count(${entityCostCodeEntity.costCodeId})`.as('cost_code_count'),
//         })
//         .from(documentLineItemEntity)
//         .leftJoin(entityCostCodeEntity, eq(entityCostCodeEntity.documentLineItemId, documentLineItemEntity.id))
//         .where(
//           this.mapFilterToQuery({
//             filter: this.withTenant(isProjectFiltered ? projectFilterObj : {}),
//             table: documentLineItemEntity,
//           }),
//         )
//         .groupBy(documentLineItemEntity.id);
//     });

//     const documentCostTotalsCte = db.$with('document_cost_totals').as(qb => {
//       return qb
//         .select({
//           documentId: documentLineItemEntity.documentId,
//           costCodeId: entityCostCodeEntity.costCodeId,
//           documentSubtotal: sql<number>`
//             sum(
//               ${this.convertDocumentAmountExpr(sql`${documentLineItemEntity.subtotal}`, tenantCurrencyCode)}
//               /
//               coalesce(nullif(lccc.cost_code_count, 0), 1)
//             )
//           `.as('document_subtotal'),
//         })
//         .from(documentLineItemEntity)
//         .innerJoin(documentEntity, eq(documentEntity.id, documentLineItemEntity.documentId))
//         .leftJoin(entityCostCodeEntity, eq(entityCostCodeEntity.documentLineItemId, documentLineItemEntity.id))
//         .leftJoin(
//           sql`${lineItemCostCodeCountsCte} lccc`,
//           eq(sql`lccc.document_line_item_id`, documentLineItemEntity.id),
//         )
//         .where(
//           and(
//             this.mapFilterToQuery({
//               filter: this.withTenant(isProjectFiltered ? projectFilterObj : {}),
//               table: documentLineItemEntity,
//             }),
//             costCodes.length
//               ? this.mapFilterToQuery({
//                   filter: this.withTenant<EntityCostCodeModel>({ costCodeId: { in: costCodes } }),
//                   table: entityCostCodeEntity,
//                 })
//               : undefined,
//           ),
//         )
//         .groupBy(documentLineItemEntity.documentId, entityCostCodeEntity.costCodeId);
//     });

//     const scopedInvoicesCte = db.$with('scoped_invoices').as(qb =>
//       /* @coreloops-ignore-tenant-check - scoped_documents is already tenant-scoped */
//       qb
//         .select({ id: scopedDocumentsCte.id })
//         .from(scopedDocumentsCte)
//         .where(
//           or(
//             eq(scopedDocumentsCte.documentType, DocumentTypeEnum.INVOICE),
//             eq(scopedDocumentsCte.documentType, DocumentTypeEnum.RECEIPT),
//           ),
//         ),
//     );

//     const scopedPurchaseOrdersCte = db.$with('scoped_purchase_orders').as(qb =>
//       /* @coreloops-ignore-tenant-check - `scoped_documents` CTE is already tenant-scoped via `withTenant */
//       qb
//         .select({ id: scopedDocumentsCte.id })
//         .from(scopedDocumentsCte)
//         .where(eq(scopedDocumentsCte.documentType, DocumentTypeEnum.PURCHASE_ORDER)),
//     );

//     const docInvoice = aliasedTable(documentEntity, 'doc_invoice');
//     const docPo = aliasedTable(documentEntity, 'doc_po');

//     const invoicePoLinksCte = db.$with('invoice_po_links').as(qb =>
//       qb
//         .select({
//           invoiceId: sql`${docInvoice.id}`.as('invoice_id'),
//           purchaseOrderId: sql`${docPo.id}`.as('po_id'),
//         })
//         .from(documentLinkEntity)
//         .innerJoin(
//           docInvoice,
//           sql`
//             (${documentLinkEntity.document1Id} = ${docInvoice.id}
//             OR ${documentLinkEntity.document2Id} = ${docInvoice.id})
//             AND (
//               ${docInvoice.documentType} = ${DocumentTypeEnum.INVOICE}
//               OR ${docInvoice.documentType} = ${DocumentTypeEnum.RECEIPT}
//             )
//           `,
//         )
//         .innerJoin(scopedInvoicesCte, eq(scopedInvoicesCte.id, docInvoice.id))
//         .innerJoin(
//           docPo,
//           sql`
//             (${documentLinkEntity.document1Id} = ${docPo.id}
//             OR ${documentLinkEntity.document2Id} = ${docPo.id})
//             AND ${docPo.documentType} = ${DocumentTypeEnum.PURCHASE_ORDER}
//           `,
//         )
//         .innerJoin(scopedPurchaseOrdersCte, eq(scopedPurchaseOrdersCte.id, docPo.id)),
//     );

//     const stmt = db
//       .with(
//         scopedDocumentsCte,
//         lineItemCostCodeCountsCte,
//         documentCostTotalsCte,
//         scopedInvoicesCte,
//         scopedPurchaseOrdersCte,
//         invoicePoLinksCte,
//       )
//       .select({
//         id: scopedDocumentsCte.id,
//         documentNumber: scopedDocumentsCte.documentNumber,
//         documentType: sql<DocumentTypeEnum | null>`${scopedDocumentsCte.documentType}`,
//         status: sql<EntityStatusEnum | null>`${scopedDocumentsCte.status}`,
//         issueDate: sql<Date | null>`${scopedDocumentsCte.issueDate}`,
//         reference: scopedDocumentsCte.reference,
//         supplierId: scopedDocumentsCte.supplierId,
//         costCodeId: documentCostTotalsCte.costCodeId,
//         documentSubtotal: documentCostTotalsCte.documentSubtotal,
//         paidAmount: sql<number | null>`
//           case
//             when ${documentCostTotalsCte.documentSubtotal} is null then null
//             when ${scopedDocumentsCte.status} = ${EntityStatusEnum.PAID}
//               then ${documentCostTotalsCte.documentSubtotal}
//             else 0
//           end
//         `,
//         linkedPurchaseOrderId: sql<string | null>`${invoicePoLinksCte.purchaseOrderId}`,
//         linkedInvoiceId: sql<string | null>`${invoicePoLinksCte.invoiceId}`,
//         outstandingAmount: sql<number | null>`
//           case
//             when ${documentCostTotalsCte.documentSubtotal} is null then null
//             when ${scopedDocumentsCte.status} = ${EntityStatusEnum.PAID} then 0
//             else ${documentCostTotalsCte.documentSubtotal}
//           end
//         `,
//         totalAmount: sql<number | null>`${documentCostTotalsCte.documentSubtotal}`,
//       })
//       .from(scopedDocumentsCte)
//       .innerJoin(documentCostTotalsCte, eq(documentCostTotalsCte.documentId, scopedDocumentsCte.id))
//       .leftJoin(
//         invoicePoLinksCte,
//         or(
//           eq(invoicePoLinksCte.invoiceId, scopedDocumentsCte.id),
//           eq(invoicePoLinksCte.purchaseOrderId, scopedDocumentsCte.id),
//         ),
//       )
//       .leftJoin(
//         costCodeEntity,
//         and(eq(costCodeEntity.id, documentCostTotalsCte.costCodeId), eq(costCodeEntity.tenantId, this.tenantId)),
//       )
//       .orderBy(
//         scopedDocumentsCte.documentType,
//         scopedDocumentsCte.issueDate,
//         sql`lower(${costCodeEntity.name}) asc nulls last`,
//         documentCostTotalsCte.costCodeId,
//       );

//     const rows = await stmt;
//     return rows.map(roundTransactionReportRowTo2dp);
//   }
// }
