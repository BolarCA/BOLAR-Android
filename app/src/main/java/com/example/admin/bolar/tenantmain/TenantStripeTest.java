package com.example.admin.bolar.tenantmain;


import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.example.admin.bolar.R;
import com.google.android.gms.tasks.Continuation;
import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.functions.FirebaseFunctionsException;
import com.google.firebase.functions.HttpsCallableResult;
import com.stripe.android.CustomerSession;
import com.stripe.android.EphemeralKeyProvider;
import com.stripe.android.EphemeralKeyUpdateListener;
import com.stripe.android.PaymentConfiguration;
import com.stripe.android.StripeError;
import com.stripe.android.model.PaymentMethod;
import com.stripe.android.model.Source;
import com.stripe.android.model.SourceParams;
import com.stripe.android.view.AddPaymentMethodActivity;
import com.stripe.android.view.PaymentMethodsActivity;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;


public class TenantStripeTest extends AppCompatActivity{

    public Button createCust;
    private Button payButton;
    private TextView defaultCard;
    private Button managePaymentMethods;
    private FirebaseFunctions mFunctions;
    private FirebaseAuth mAuth;
    private Context context;
    private static final int REQUEST_CODE_SELECT_SOURCE = 55;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tenant_stripe_test);

        context = this.getBaseContext();
        createCust = findViewById(R.id.customerObject);
        defaultCard = findViewById(R.id.defaultCardText);
        payButton = findViewById(R.id.payButton);
        managePaymentMethods = findViewById(R.id.managePayments);
        mFunctions = FirebaseFunctions.getInstance();
        mAuth = FirebaseAuth.getInstance();
        PaymentConfiguration.init("pk_test_m6Zr1Pwobr0GlDsiMJBLKf4Z");
        CustomerSession.initCustomerSession(context, new TenantEphemeralKeyProvider());

        createCust.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                createCustomer("");
            }
        });

        managePaymentMethods.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final Intent payIntent = new Intent(TenantStripeTest.this , PaymentMethodsActivity.class);
                startActivityForResult(payIntent, REQUEST_CODE_SELECT_SOURCE);
                //TenantStripeTest.this.startActivity(payIntent);
            }
        });

        payButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                payLandlord("","");
            }
        });

    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_CODE_SELECT_SOURCE && resultCode == RESULT_OK) {
            final PaymentMethod paymentMethod = data.getParcelableExtra(PaymentMethodsActivity.EXTRA_SELECTED_PAYMENT);

            if (paymentMethod != null && paymentMethod.card != null) {
                defaultCard.setText(buildCardString(paymentMethod.card));
                CustomerSession.getInstance().addCustomerSource(paymentMethod.id, Source.CARD, new CustomerSession.SourceRetrievalListener() {
                    @Override
                    public void onError(int errorCode, @Nullable String errorMessage, @Nullable StripeError stripeError) {

                    }

                    @Override
                    public void onSourceRetrieved(@NonNull Source source) {

                    }
                });
            }
        }
    }

    @NonNull
    private String buildCardString(@NonNull PaymentMethod.Card data) {
        return data.brand + getString(R.string.ending_in) + data.last4;
    }

    private Task<String> createCustomer(String text) {
        // Create the arguments to the callable function.
        Map<String, Object> data = new HashMap<>();
        //replace email with something like mAuth.getCurrentUser().getEmail() but its null rn :/
        data.put("email", "88@email.com");
        data.put("push", true);

        return mFunctions
                .getHttpsCallable("CreateCustomerObject")
                .call(data)
                .continueWith(new Continuation<HttpsCallableResult, String>() {
                    @Override
                    public String then(@NonNull Task<HttpsCallableResult> task) throws Exception {
                        // This continuation runs on either success or failure, but if the task
                        // has failed then getResult() will throw an Exception which will be
                        // propagated down.
                        String result = (String) task.getResult().getData();
                        return result;
                    }
                });
    }

    private Task<String> payLandlord(String custId, String landlordConnectId) {
        // Create the arguments to the callable function.
        Map<String, Object> data = new HashMap<>();
        //replace with IDs from database
        data.put("custId", "cus_FDRLk23tmr5CGR");
        data.put("connectId", "acct_1Eiz9NJTlIKWWtAo");
        data.put("push", true);

        return mFunctions
                .getHttpsCallable("DestinationCharge")
                .call(data)
                .continueWith(new Continuation<HttpsCallableResult, String>() {
                    @Override
                    public String then(@NonNull Task<HttpsCallableResult> task) throws Exception {
                        // This continuation runs on either success or failure, but if the task
                        // has failed then getResult() will throw an Exception which will be
                        // propagated down.
                        String result = (String) task.getResult().getData();
                        return result;
                    }
                });
    }

}
