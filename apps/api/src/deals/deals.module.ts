import { Module } from "@nestjs/common";
import { CurrencyModule } from "../currency/currency.module";
import { TrpcModule } from "../trpc/trpc.module";
import { DealsRouter } from "./deals.router";
import { DealsService } from "./deals.service";

@Module({
	imports: [TrpcModule, CurrencyModule],
	providers: [DealsService, DealsRouter],
	exports: [DealsService],
})
export class DealsModule {}
