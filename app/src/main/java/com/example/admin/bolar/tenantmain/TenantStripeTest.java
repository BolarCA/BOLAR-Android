package com.example.admin.bolar.tenantmain;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;

import com.example.admin.bolar.R;
import com.google.android.gms.tasks.Continuation;
import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.functions.FirebaseFunctions;
import com.google.firebase.functions.HttpsCallableResult;

import java.util.HashMap;
import java.util.Map;

public class TenantStripeTest extends AppCompatActivity {

    public Button createCust;
    private FirebaseFunctions mFunctions;
    private FirebaseAuth mAuth;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_tenant_stripe_test);

        createCust = findViewById(R.id.customerObject);
        mFunctions = FirebaseFunctions.getInstance();
        mAuth = FirebaseAuth.getInstance();

        createCust.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                createCustomer("");
            }
        });

    }

    private Task<String> createCustomer(String text) {
        // Create the arguments to the callable function.
        Map<String, Object> data = new HashMap<>();
        //replace email with something like mAuth.getCurrentUser().getEmail() but its null rn :/
        data.put("email", "test3@email.com");
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
}
